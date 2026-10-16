import { device, timestampsSupported } from './renderer';

const urlParams = new URLSearchParams(window.location.search);

export const benchMode = urlParams.get('bench') === '1';
export const PASSES = ['moveLights', 'clustering', 'main', 'gbuffer', 'fullscreen'] as const;
export type PassName = typeof PASSES[number];

const RING_SIZE = 8;
const QUERIES_PER_PASS = 2;

interface Slot {
    resolveBuf: GPUBuffer;
    readBuf: GPUBuffer;
    busy: boolean;
}

export interface ResolveHandle {
    slot: Slot;
    first: number; // first query index
    count: number; // number of queries resolved
    names: PassName[];
}

export class GpuTimer {
    private querySet: GPUQuerySet | null = null;
    private slots: Slot[] = [];

    constructor(enabled: boolean) {
        if (!enabled) return;

        const count = PASSES.length * QUERIES_PER_PASS;
        this.querySet = device.createQuerySet({ type: 'timestamp', count });
        this.slots = Array.from({ length: RING_SIZE }, () => ({
            resolveBuf: device.createBuffer({
                size: count * 8,
                usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC
            }),
            readBuf: device.createBuffer({
                size: count * 8,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
            }),
            busy: false
        }));
    }
    passWrites(name: PassName): GPUComputePassTimestampWrites | undefined {
        if (this.querySet === null) return undefined;
        const i = PASSES.indexOf(name) * QUERIES_PER_PASS;
        return { querySet: this.querySet, beginningOfPassWriteIndex: i, endOfPassWriteIndex: i + 1 };
    }
    resolve(encoder: GPUCommandEncoder, names: PassName[]): ResolveHandle | null {
        if (this.querySet === null) return null;
        const slot = this.slots.find(s => !s.busy);
        if (!slot) return null;

        const idx = names.map(n => PASSES.indexOf(n));
        const first = Math.min(...idx) * QUERIES_PER_PASS;
        const count = (Math.max(...idx) + 1) * QUERIES_PER_PASS - first;

        slot.busy = true;
        // destination offset of a resolve must be a multiple of 256, so always resolve to offset 0
        encoder.resolveQuerySet(this.querySet, first, count, slot.resolveBuf, 0);
        encoder.copyBufferToBuffer(slot.resolveBuf, 0, slot.readBuf, 0, count * 8);
        return { slot, first, count, names };
    }

    // Call after queue.submit() with the handle from resolve(); a null handle is ignored.
    collect(handle: ResolveHandle | null) {
        if (handle === null) return;
        const h: ResolveHandle = handle;
        h.slot.readBuf.mapAsync(GPUMapMode.READ, 0, h.count * 8).then(() => {
            const t = new BigUint64Array(h.slot.readBuf.getMappedRange(0, h.count * 8).slice(0));
            h.slot.readBuf.unmap();
            h.slot.busy = false;

            let total = 0;
            let valid = true;
            for (const name of h.names) {
                const k = PASSES.indexOf(name) * QUERIES_PER_PASS - h.first;
                const begin = t[k], end = t[k + 1];
                if (end < begin) { valid = false; continue; } // timestamps can be discontinuous (e.g. GPU reset)
                const ms = Number(end - begin) / 1e6;
                record(name, ms);
                if (name !== 'moveLights') total += ms;
            }
            if (valid && h.names.some(n => n !== 'moveLights')) record('gpuTotal', total);
        }).catch(() => { h.slot.busy = false; });
    }
}

// disabled until initTimer() runs, so callers never need a null check
export let timer = new GpuTimer(false);

export function initTimer() {
    timer = new GpuTimer(timestampsSupported);
    if (!timestampsSupported) {
        console.warn("timestamp-query not supported: only CPU frame time will be reported");
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Sample storage
// ---------------------------------------------------------------------------------------------------------------

const LIVE_WINDOW = 120;

export const metrics = {
    live: {} as Record<string, number[]>,
    capture: null as Record<string, number[]> | null,
    frame: 0,
    lastTime: null as number | null
};

export function record(name: string, ms: number) {
    if (!(name in metrics.live)) metrics.live[name] = [];
    const live = metrics.live[name];
    live.push(ms);
    if (live.length > LIVE_WINDOW) live.shift();
    if (metrics.capture !== null) {
        if (!(name in metrics.capture)) metrics.capture[name] = [];
        metrics.capture[name].push(ms);
    }
}

const waiters: { target: number, resolve: () => void }[] = [];

// Called once per animation frame by the renderer; records CPU frame-to-frame time.
export function onFrame(time: number) {
    metrics.frame++;
    if (metrics.lastTime !== null) record('cpu', time - metrics.lastTime);
    metrics.lastTime = time;

    for (let i = waiters.length - 1; i >= 0; i--) {
        if (metrics.frame >= waiters[i].target) {
            waiters[i].resolve();
            waiters.splice(i, 1);
        }
    }
}

// Call when switching renderer so the gap isn't recorded as a frame time.
export function resetClock() {
    metrics.lastTime = null;
    metrics.live = {};
}

export function waitFrames(n: number): Promise<void> {
    return new Promise(resolve => waiters.push({ target: metrics.frame + n, resolve }));
}

// ---------------------------------------------------------------------------------------------------------------
// Recording and export
// ---------------------------------------------------------------------------------------------------------------

export interface Summary {
    n: number;
    mean: number;
    median: number;
    p95: number;
    min: number;
    max: number;
    std: number;
}

export function summarize(values: number[]): Summary {
    const v = [...values].sort((a, b) => a - b);
    const n = v.length;
    const mean = v.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    const q = (p: number) => v[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))];
    return { n, mean, median: q(0.5), p95: q(0.95), min: v[0], max: v[n - 1], std };
}

// Discards `warmup` frames, then collects `samples` frames of every metric and returns per-metric summaries (ms).
export async function measure(warmup: number, samples: number): Promise<Record<string, Summary>> {
    await waitFrames(warmup);
    metrics.capture = {};
    const start = metrics.frame;

    // GPU results arrive a few frames late, so wait until every metric seen has enough samples (with a cap)
    while (true) {
        await waitFrames(5);
        const c = metrics.capture;
        const names = Object.keys(c);
        const done = 'cpu' in c && names.every(k => c[k].length >= samples);
        if (done || metrics.frame - start > 3 * samples + 120) break;
    }

    const cap = metrics.capture;
    metrics.capture = null;

    const out: Record<string, Summary> = {};
    for (const [name, vals] of Object.entries(cap)) {
        if (vals.length > 0) out[name] = summarize(vals.slice(0, samples));
    }
    return out;
}

export type Row = Record<string, string | number>;
export const results: Row[] = [];

export function addResults(meta: Record<string, string | number>, summaries: Record<string, Summary>) {
    for (const [pass, s] of Object.entries(summaries)) {
        results.push({
            ...meta,
            pass,
            n: s.n,
            mean_ms: +s.mean.toFixed(4),
            median_ms: +s.median.toFixed(4),
            p95_ms: +s.p95.toFixed(4),
            min_ms: +s.min.toFixed(4),
            max_ms: +s.max.toFixed(4),
            std_ms: +s.std.toFixed(4)
        });
    }
}

export function toCsv(rows: Row[]): string {
    if (rows.length === 0) return '';
    const cols = Object.keys(rows[0]);
    return [cols.join(','), ...rows.map(r => cols.map(c => r[c]).join(','))].join('\n');
}

export function downloadCsv(filename = 'benchmark.csv') {
    const blob = new Blob([toCsv(results)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}

// Small always-on readout of the rolling mean of each metric
export function createHud(): HTMLElement {
    const el = document.createElement('pre');
    Object.assign(el.style, {
        position: 'fixed', left: '0', top: '50px', margin: '0', padding: '4px 6px',
        background: 'rgba(0,0,0,0.6)', color: '#0f0', font: '11px monospace', pointerEvents: 'none'
    });
    document.body.appendChild(el);
    setInterval(() => {
        const lines = Object.entries(metrics.live)
            .filter(([, v]) => v.length > 0)
            .map(([k, v]) => `${k.padEnd(10)} ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3)} ms`);
        el.textContent = lines.join('\n');
    }, 500);
    return el;
}
