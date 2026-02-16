# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Six-tab interactive visualization of 82,000+ Steam games (2005-2025). Static HTML + vanilla JS with D3.js — no build step, no framework. All rendering uses Canvas 2D API (not SVG) for performance with 80K+ data points.

**Live URL**: https://dr.eamer.dev/datavis/interactive/steam/

## Architecture

### Tab System & View Module Pattern

`index.html` (~2500 lines) contains the Universe (scatter) tab inline. Five additional views are loaded as external `<script>` tags that self-register into `window._steamViews`:

| Tab | File | Key | Canvas Element |
|-----|------|-----|----------------|
| Universe | inline in `index.html` | `scatter` | `#canvas` |
| Chord | `chord.js` | `chord` | `#canvas-chord` |
| Network | `force.js` | `force` | `#canvas-force` |
| Stream | `stream.js` | `stream` | `#canvas-stream` |
| Heatmap | `heatmap.js` | `heatmap` | `#canvas-heatmap` |
| Treemap | `treemap.js` | `treemap` | `#canvas-treemap` |

Each view module is an IIFE that registers `{ init(), activate(), deactivate(), resize?() }` at `window._steamViews.<key>`. Views are lazy-initialized on first tab switch. The tab switcher at the bottom of `index.html` manages canvas visibility and lifecycle calls.

### Shared Global State

Views access shared data through globals set by `index.html` during loading:

```
window._steamData = { allGames, networkNodes, networkEdges, genreNames, tagNames, ratingNames, titleToGame }
window._steamViews = {}              // View module registry
window._steamActiveTab = () => tab   // Current active tab name
window._steamCanvases = {}           // Canvas element map
window._steamExportScatter(w, h)     // Returns offscreen scatter canvas for export
```

### Data Format (in-memory)

Games are packed arrays for minimal JSON size:

```
steam_all_2005.json games[]: [name, year, ratio, reviews, price, ratingIdx, genreIdxs, tagIdxs, developer]
                              [0]    [1]   [2]    [3]      [4]    [5]        [6]        [7]       [8]
```

Genres and tags are index arrays referencing top-level `genres[]` and `tags[]` lookup tables. Network nodes in `steam_network.json` are matched to games by title string at load time (`titleToGame` Map).

## Data Pipeline

Source data lives in `/home/coolhand/html/datavis/data_trove/entertainment/gaming/`.

### Source Data

| File | Location | Content |
|------|----------|---------|
| `enriched/games.csv` | data_trove | fronkongames dataset (122K games, Jan 2026) — **primary source** |
| `reviews_2024/SteamReviews2024/` | data_trove | artermiloff review CSVs (128M reviews, one CSV per game, 2012-June 2024) |
| `games.csv` | data_trove | Original Kaggle dataset (~51K games) — legacy, superseded |

### Pipeline Scripts

```bash
# 1. Build co-review network (SLOW — scans 128M reviews across 30K CSV files)
python3 build_network_v2.py
# Output: steam_network.json (41 MB)

# 2. Build all-games catalog from fronkongames enriched CSV
python3 enrich_data.py
# Output: steam_all_2005.json (6.2 MB, ~83K games)
# Also updates steam_network.json with genre/tag data

# 3. Pre-compute force-directed layout positions (requires networkx, scipy)
python3 compute_layout.py
# Output: steam_force_layout.json (252K) — warm-start positions for Network tab
```

**build_network_v2.py** parameters controlling network density: `TOP_K = 50`, `MIN_SHARED = 5`, `MAX_USER_GAMES = 75`. Column 14 in each review CSV is `author_steamid`.

**enrich_data.py** — the fronkongames CSV has a **known header bug**: the column `DiscountDLC count` is actually two columns (`Discount`, `DLC count`), so all column indices from position 8+ are offset by 1. The `COL` dict at the top of the file handles this.

**build_all_games.py** is legacy (uses old `games.csv`) — superseded by `enrich_data.py`.

### After rebuilding data

Bump the cache-buster version `const _v = 'v=22'` in `index.html` (line ~946, search for `_v`) to force browser cache refresh.

## View Details

### Universe (scatter — inline in index.html)

- **Layout**: X = release year (2005-2025), Y = positive review % (0-100), dot size = `d3.scaleSqrt(review count)`
- **D3 quadtree** for hit detection (radius-aware)
- **Edge rendering**: Bezier curves with year-column bundling and color-coded year-span buckets (same-year red → 10+ year purple)
- **LOD**: Edge count scales with zoom level and density slider. During pan/zoom (`isInteracting`), edges suppressed, re-rendered after 120ms idle
- **Labels**: Shown at zoom k >= 1.5, collision-detected, top games by review count first
- **Color modes**: Rating (categorical), Price (bucketed), Year (Viridis), Reviews (Inferno log)
- **Controls**: Search, info panel (hover preview / click pin), density slider, genre filter pills, fullscreen

### Chord (`chord.js`)

Three modes: Genre co-reviews, Tag co-reviews, Games co-reviews (top N games). Hover arcs/ribbons for detail. Zoom/pan via D3 zoom. Mode transition animation with fade.

### Network (`force.js`)

Live d3-force simulation of ~9K network nodes. Warm-starts from pre-computed positions (`steam_force_layout.json`). Drag nodes to rearrange. Keyboard: R = reheat simulation, F = fit to screen.

### Stream (`stream.js`)

Streamgraph of genre share evolution over time (2005-2025). Horizontal scroll, major game launch markers.

### Heatmap (`heatmap.js`)

Genre × Year density matrix. Sqrt color scale, sqrt-proportional row heights. Zoom/pan.

### Treemap (`treemap.js`)

Hierarchical treemap with drill-down (Genre → Tag → Game). Animated zoom transitions, breadcrumb navigation.

## Hi-Res Export

```bash
node export_hires.js [--only universe|network|chord] [--res 4k|8k|16k]
```

Playwright-based export that loads the page headless and renders publication-quality PNGs to `exports/`. Requires `playwright` npm package.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Main page: CSS, Universe tab JS, tab switcher (~2500 lines) |
| `chord.js` | Chord diagram view module |
| `force.js` | Network graph view module (live d3-force) |
| `stream.js` | Streamgraph view module |
| `heatmap.js` | Heatmap view module |
| `treemap.js` | Treemap view module |
| `steam_all_2005.json` | All 83K games catalog (6.2 MB) |
| `steam_network.json` | Co-review network (41 MB) |
| `steam_force_layout.json` | Pre-computed force layout positions (252K) |
| `enrich_data.py` | Primary data builder (fronkongames CSV → JSON) |
| `build_network_v2.py` | Network builder (review CSVs → steam_network.json) |
| `compute_layout.py` | Force layout pre-computation (networkx) |
| `export_hires.js` | Playwright hi-res PNG export |
| `build_all_games.py` | Legacy catalog builder (superseded) |

### Legacy JS files (unused, from earlier prototypes)

`force-directed-graph.js`, `steam_chord_diagram.js`, `steam_heatmap.js`, `steam_treemap.js`, `tree.js` — these were superseded by the current view modules.

## Performance Notes

- `scheduleRender()` uses `requestAnimationFrame` to debounce renders
- Viewport culling skips dots outside visible bounds
- Edge rendering is the bottleneck — density slider and zoom-based LOD are essential
- Hub nodes (degree > 80) get dimmed edges to prevent visual noise
- All canvases use DPR-scaled backing store for retina displays
