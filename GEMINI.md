# Steam Universe: Interactive Visualization

A high-performance, six-tab interactive visualization of 82,000+ Steam games (2005-2025). This project uses a custom D3.js and Canvas-based architecture to render massive datasets smoothly in the browser without a build step.

## Project Overview

- **Purpose**: To visualize the evolution of the Steam library through multiple lenses (popularity, genre, co-review networks, and hierarchical trends).
- **Architecture**:
    - **Vanilla JS & D3.js**: No frameworks (React/Vue) or build tools (Webpack/Vite).
    - **Canvas 2D Rendering**: Used for all major visualizations to handle 80K+ data points efficiently.
    - **View Module Pattern**: Each visualization is an IIFE that registers `{ init, activate, deactivate, resize }` into `window._steamViews`.
    - **Shared Data**: All views access a global `window._steamData` object containing games, network nodes/edges, and lookup tables for genres and tags.
- **Live URL**: [https://dr.eamer.dev/datavis/interactive/steam/](https://dr.eamer.dev/datavis/interactive/steam/)

## Key Visualization Tabs

| Tab | Key | File | Description |
|-----|-----|------|-------------|
| **Universe** | `scatter` | `index.html` (inline) | Release Year vs. Approval Rating scatter plot with co-review edge overlays. |
| **Chord** | `chord` | `chord.js` | Co-review relationships between Genres, Tags, and top Games. |
| **Network** | `force` | `force.js` | Live d3-force simulation of ~9K connected game nodes. |
| **Stream** | `stream` | `stream.js` | Evolution of genre market share over two decades. |
| **Heatmap** | `heatmap` | `heatmap.js` | Density matrix of Genres vs. Release Year. |
| **Treemap** | `treemap` | `treemap.js` | Hierarchical drill-down from Genres to Tags to individual Games. |

## Data Pipeline

Data is processed from large CSV sources (fronkongames dataset and 128M+ reviews) into compact JSON files for the web.

### 1. Rebuilding Data
Run these Python scripts in order to update the visualization data:

```bash
# Step 1: Build the co-review network (requires access to review CSVs)
python3 build_network_v2.py

# Step 2: Build the all-games catalog and enrich network nodes
python3 enrich_data.py

# Step 3: Pre-compute force-directed layout positions (requires networkx, scipy)
python3 compute_layout.py
```

### 2. High-Resolution Export
Generate publication-quality PNGs (4K/8K/16K) using Playwright:

```bash
node export_hires.js [--only universe|network|chord] [--res 4k|8k|16k]
```

## Development Conventions

- **Performance First**: Always prefer `requestAnimationFrame` and `Canvas` over SVG for rendering large datasets.
- **Global State**: Coordinate between views using `window._steamData` and the lifecycle methods in `window._steamViews`.
- **Memory Efficiency**: Games in JSON are stored as packed arrays. Refer to the `COL` mapping in `enrich_data.py` or the comments in `index.html` for index meanings.
- **Cache-Busting**: After updating JSON data, increment the `_v` constant (e.g., `const _v = 'v=22'`) in `index.html` to force clients to reload the data.
- **Legacy Files**: `force-directed-graph.js`, `steam_chord_diagram.js`, `steam_heatmap.js`, `steam_treemap.js`, and `tree.js` are legacy prototypes and should be ignored in favor of the current view modules.

## Key Files

- `index.html`: Entry point, UI layout, CSS, and the Universe (scatter) visualization logic.
- `chord.js`, `force.js`, `stream.js`, `heatmap.js`, `treemap.js`: Individual view modules.
- `steam_all_2005.json`: Compact game catalog (primary data).
- `steam_network.json`: Relationship graph data.
- `steam_force_layout.json`: Warm-start positions for the Network tab.
- `enrich_data.py`: Primary data processing script.
- `visual_enhancements.js`: Shared utility functions for gradients, glows, and transitions.
