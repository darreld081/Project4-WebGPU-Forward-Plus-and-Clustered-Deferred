WebGL Forward+ and Clustered Deferred Shading
======================

**University of Pennsylvania, CIS 565: GPU Programming and Architecture, Project 4**

* (TODO) YOUR NAME HERE
* Tested on: (TODO) **Google Chrome 222.2** on
  Windows 22, i7-2222 @ 2.22GHz 22GB, GTX 222 222MB (Moore 2222 Lab)

### Live Demo

[![](img/thumb.png)](http://TODO.github.io/Project4-WebGPU-Forward-Plus-and-Clustered-Deferred)

### Demo Video/GIF

[![](img/video.mp4)](TODO)

### (TODO: Your README)

*DO NOT* leave the README to the last minute! It is a crucial part of the
project, and we will not be able to grade you without a good README.

This assignment has a considerable amount of performance analysis compared
to implementation work. Complete the implementation early to leave time!

### Credits

- [Vite](https://vitejs.dev/)
- [loaders.gl](https://loaders.gl/)
- [dat.GUI](https://github.com/dataarts/dat.gui)
- [stats.js](https://github.com/mrdoob/stats.js)
- [wgpu-matrix](https://github.com/greggman/wgpu-matrix)

## Performance benchmarking

All timings are in **milliseconds**. A live readout (top-left, under the stats.js panel) shows the rolling mean of:
`cpu` (frame-to-frame time), `moveLights`, `clustering`, `main` (naive / Forward+ render pass), `gbuffer`, `fullscreen`
(deferred passes) and `gpuTotal` (sum of the render-path GPU passes, excluding `moveLights`).
GPU pass times use WebGPU timestamp queries, which are not capped by vsync.

For accurate timings launch Chrome with `--enable-webgpu-developer-features` (otherwise timestamps are quantized to ~100 us).
For uncapped `cpu` frame time also use `--disable-frame-rate-limit --disable-gpu-vsync`.

**GUI → Benchmark (ms):** `run current config` records warmup+sample frames for the active renderer;
`run sweep` runs naive, forward+ and clustered deferred over the comma-separated `sweepLights` list;
`download CSV` exports mean / median / p95 / min / max / std per pass, with the parameters of each run.

**URL parameters** (values are baked into the shaders, so each change needs a reload):
`?bench=1` (deterministic light motion), `numLights`, `mode` (`naive`, `forward+`, `clustered deferred`),
`clusterX`, `clusterY`, `clusterZ`, `lightsPerCluster`, `lightRadius`, `clusterGroupSize`, `moveLightsWorkgroupSize`,
`width`, `height`, `lights` (sweep list), and `auto=1` (run the sweep on load and download the CSV).

Example: `http://localhost:5173/?bench=1&auto=1&clusterX=32&clusterY=32&clusterZ=32&lights=500,2000,5000`
