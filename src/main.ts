import Stats from 'stats.js';
import { GUI } from 'dat.gui';

import { initWebGPU, Renderer, canvas, timestampsSupported } from './renderer';
import { NaiveRenderer } from './renderers/naive';
import { ForwardPlusRenderer } from './renderers/forward_plus';
import { ClusteredDeferredRenderer } from './renderers/clustered_deferred';

import { setupLoaders, Scene } from './stage/scene';
import { Lights } from './stage/lights';
import { Camera } from './stage/camera';
import { Stage } from './stage/stage';

import * as shaders from './shaders/shaders';
import * as bench from './benchmark';

await initWebGPU();
bench.initTimer();
setupLoaders();

let scene = new Scene();
await scene.loadGltf('./scenes/sponza/Sponza.gltf');

const camera = new Camera();
const lights = new Lights(camera);

const stats = new Stats();
stats.showPanel(0);
document.body.appendChild(stats.dom);
bench.createHud();

const urlParams = new URLSearchParams(window.location.search);

const gui = new GUI();
const numLightsController = gui.add(lights, 'numLights').min(1).max(Lights.maxNumLights).step(1).onChange(() => {
    lights.updateLightSetUniformNumLights();
});
if (urlParams.has('numLights')) {
    lights.numLights = Math.min(Lights.maxNumLights, Math.max(1, Number(urlParams.get('numLights')) || lights.numLights));
    lights.updateLightSetUniformNumLights();
    numLightsController.updateDisplay();
}

const stage = new Stage(scene, lights, camera, stats);

var renderer: Renderer | undefined;

function setRenderer(mode: string) {
    renderer?.stop();
    bench.resetClock();

    switch (mode) {
        case renderModes.naive:
            renderer = new NaiveRenderer(stage);
            break;
        case renderModes.forwardPlus:
            renderer = new ForwardPlusRenderer(stage);
            break;
        case renderModes.clusteredDeferred:
            renderer = new ClusteredDeferredRenderer(stage);
            break;
    }
}

const renderModes = { naive: 'naive', forwardPlus: 'forward+', clusteredDeferred: 'clustered deferred' };
let renderModeController = gui.add({ mode: urlParams.has('mode') ? String(urlParams.get('mode')) : renderModes.naive }, 'mode', renderModes);
renderModeController.onChange(setRenderer);

setRenderer(renderModeController.getValue());

// ---------------------------------------------------------------------------------------------------------------
// Benchmarking. Timings are in milliseconds; GPU pass times need the 'timestamp-query' feature.
// Cluster counts / lightsPerCluster / lightRadius / resolution are set via URL params (see README) and need a reload.
// ---------------------------------------------------------------------------------------------------------------

function currentMeta() {
    const c = shaders.constants;
    return {
        renderer: renderModeController.getValue() as string,
        numLights: lights.numLights,
        clusterX: c.clusterX,
        clusterY: c.clusterY,
        clusterZ: c.clusterZ,
        lightsPerCluster: c.lightsPerCluster,
        lightRadius: c.lightRadius,
        clusterGroupSize: c.clusterGroupSize,
        width: canvas.width,
        height: canvas.height,
        gpuTimestamps: timestampsSupported ? 1 : 0
    };
}

const benchSettings = {
    warmupFrames: 120,
    sampleFrames: 300,
    sweepLights: urlParams.has('lights') ? String(urlParams.get('lights')) : '100,500,1000,2000,5000',
    running: false,

    runCurrent: async () => {
        if (benchSettings.running) return;
        benchSettings.running = true;
        try {
            const summaries = await bench.measure(benchSettings.warmupFrames, benchSettings.sampleFrames);
            bench.addResults(currentMeta(), summaries);
        } finally {
            benchSettings.running = false;
        }
    },

    // every renderer x every light count, with the cluster/resolution params of the current page
    runSweep: async () => {
        if (benchSettings.running) return;
        benchSettings.running = true;
        try {
            const counts = benchSettings.sweepLights.split(',').map(Number).filter(n => n >= 1);
            for (const mode of Object.values(renderModes)) {
                renderModeController.setValue(mode); // triggers setRenderer
                for (const n of counts) {
                    lights.numLights = Math.min(n, Lights.maxNumLights);
                    lights.updateLightSetUniformNumLights();
                    numLightsController.updateDisplay();
                    bench.resetClock();
                    const summaries = await bench.measure(benchSettings.warmupFrames, benchSettings.sampleFrames);
                    bench.addResults(currentMeta(), summaries);
                }
            }
        } finally {
            benchSettings.running = false;
        }
    },

    downloadCsv: () => bench.downloadCsv(),
    clearResults: () => { bench.results.length = 0; }
};

const benchFolder = gui.addFolder('Benchmark (ms)');
benchFolder.add(benchSettings, 'warmupFrames').min(0).step(1);
benchFolder.add(benchSettings, 'sampleFrames').min(10).step(1);
benchFolder.add(benchSettings, 'sweepLights');
benchFolder.add(benchSettings, 'runCurrent').name('run current config');
benchFolder.add(benchSettings, 'runSweep').name('run sweep (renderers x lights)');
benchFolder.add(benchSettings, 'downloadCsv').name('download CSV');
benchFolder.add(benchSettings, 'clearResults').name('clear results');
benchFolder.open();

// ?auto=1 runs the sweep on load and downloads the CSV; results are also exposed for automation
(window as any).benchResults = bench.results;
if (urlParams.get('auto') === '1') {
    await benchSettings.runSweep();
    bench.downloadCsv(`benchmark_${shaders.constants.clusterX}x${shaders.constants.clusterY}x${shaders.constants.clusterZ}.csv`);
    (window as any).benchDone = true;
}
