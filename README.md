WebGPU Forward+ and Clustered Deferred Shading
======================

**University of Pennsylvania, CIS 565: GPU Programming and Architecture, Project 4**

* Darrel Dsouza
* Tested on: **Google Chrome 155** on Windows 11 (lab remote desktop, 32 Hz virtual display), NVIDIA T1000, 31 GB RAM

### Live Demo

[darreld081.github.io/Project4-WebGPU-Forward-Plus-and-Clustered-Deferred](https://darreld081.github.io/Project4-WebGPU-Forward-Plus-and-Clustered-Deferred/)

[Demo video](img/feature_demo_recording.mp4)

![Clustered deferred, 1000 lights](img/cluster_deferred_1000.png)

## Overview

Three renderers for the Sponza scene with up to 5000 dynamic point lights:

| Renderer | How lights are handled |
|---|---|
| **Naive** | Every fragment loops over every light. |
| **Forward+** | A compute pass assigns lights to a 3D grid of view-space clusters (exponential depth slices). Each fragment only loops over the lights in its cluster. |
| **Clustered deferred** | Same light clustering, but geometry is first rendered to a G-buffer (position, normal, albedo); a fullscreen pass then shades each pixel once. |

Defaults: 16×16×16 clusters, at most 256 lights per cluster, light radius 2.

## Performance analysis

GPU times are in **milliseconds** from WebGPU timestamp queries (mean of 200–300 frames after warmup), so they are not limited by the display refresh rate. Raw data: [`img/*.csv`](img), plots: [`img/benchmark_graphs.xlsx`](img/benchmark_graphs.xlsx).

### Number of lights (2074×1298, 16³ clusters)

![GPU time vs number of lights](img/gpu_time_vs_num_lights.png)

| Lights | Naive | Forward+ | Clustered deferred |
|---:|---:|---:|---:|
| 100 | 48.4 | 5.9 | 7.5 |
| 500 | 233.2 | 10.8 | 9.3 |
| 1000 | 468.0 | 25.5 | 11.5 |
| 2000 | 941.1 | 50.8 | 18.9 |
| 5000 | 2374.7 | 82.6 | 32.5 |

- **Naive** grows linearly (about 0.47 ms per light) and is unusable at a few hundred lights.
- **Forward+** is 8× to 29× faster than naive. The clustering pass itself is cheap (0.06 ms at 100 lights, 2.2 ms at 5000).
- **Clustered deferred** is 6× to 73× faster than naive. It has a fixed G-buffer cost (about 4.5 to 6 ms) that makes it slightly slower than Forward+ at 100 lights. From 500 lights up it wins, and it is about 2.5× faster than Forward+ at 5000 lights, because lighting is computed once per visible pixel instead of per fragment (overdraw).

### Number of clusters (clustered deferred, 5000 lights, 2880×1350)

![GPU time vs number of clusters](img/gpu_time_vs_num_clusters.png)

| Grid | Clusters | clustering | gbuffer | fullscreen | **total** |
|---|---:|---:|---:|---:|---:|
| 5³ | 125 | 2.05 | 8.06 | 36.37 | 46.49 |
| 10³ | 1,000 | 2.02 | 7.95 | 36.23 | 46.19 |
| 15³ | 3,375 | 2.14 | 8.06 | 35.31 | **45.52** |
| 20³ | 8,000 | 4.53 | 7.38 | 34.04 | 45.95 |
| 25³ | 15,625 | 8.31 | 6.06 | 32.64 | 47.01 |

More clusters make the clustering pass more expensive (it tests every light against every cluster) but shorten the per-pixel light loop, so total time is nearly flat, with a shallow minimum around 15³ (about 3% variation overall).

### Visual effect of coarse grids

Coarse grids show blocky lighting discontinuities along cluster boundaries; finer grids do not.

| 15³ (3,375 clusters) | 30³ (27,000 clusters) |
|---|---|
| ![](img/grid_effect_cluster_deferred_5000lights_3375clusters.png) | ![](img/no_grid_effect_cluster_deferred_5000lights_27000clusters.png) |

The likely cause is lights being dropped once a cluster exceeds the 256-light cap, but this was not verified.

### Caveats

- The lab remote desktop refreshes at 32 Hz, so frame-to-frame (`cpu`) time reads about 31 ms regardless of load. Only GPU pass times are used above.
- The two sweeps used different resolutions, so absolute times are not comparable between the two tables.
- All numbers come from a single machine; only N×N×N grids and 256 lights per cluster were measured.

## Running the benchmarks

```
npm install
npm run dev
```

Open the page, then use **GUI → Benchmark (ms)** (`run sweep`, `download CSV`). For precise GPU timestamps launch Chrome with `--enable-webgpu-developer-features`. Live per-pass times are shown under the FPS panel.

URL parameters (shader-baked values need a reload): `numLights`, `mode`, `clusterX`, `clusterY`, `clusterZ`, `lightsPerCluster`, `lightRadius`, `clusterGroupSize`, `moveLightsWorkgroupSize`, `width`, `height`, `lights` (sweep list), `bench=1` (deterministic light motion), `auto=1` (run the sweep on load and download the CSV).

```
http://localhost:5173/?bench=1&auto=1&clusterX=32&clusterY=32&clusterZ=32&lights=500,2000,5000
```

### Credits

- [Vite](https://vitejs.dev/)
- [loaders.gl](https://loaders.gl/)
- [dat.GUI](https://github.com/dataarts/dat.gui)
- [stats.js](https://github.com/mrdoob/stats.js)
- [wgpu-matrix](https://github.com/greggman/wgpu-matrix)
