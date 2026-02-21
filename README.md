# Steam Network Visualization

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://dr.eamer.dev/datavis/interactive/steam/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![D3.js](https://img.shields.io/badge/D3.js-v7-orange)](https://d3js.org/)

Interactive force-directed graph of the Steam game library — ~82,000 games connected by shared players, genre, and developer relationships.

![Steam Network Visualization](https://raw.githubusercontent.com/lukeslp/steam-network-visualization/master/social-card.png)

**[Launch the visualization →](https://dr.eamer.dev/datavis/interactive/steam/)**

## Features

- **Force-directed graph** — 82K+ game nodes with physics-based layout
- **Genre filters** — Isolate Action, RPG, Strategy, Indie, and more
- **Year-span timeline** — See how the library evolved from 2003 to present
- **Per-game analysis** — Pin any game to explore its connections and metadata
- **Search** — Jump directly to any game by name
- **Zoom and pan** — Navigate the full network at any scale

## Data

Game and connection data sourced from the Steam public API and processed into a network graph format. Raw data available in the companion [steam-network-data](https://github.com/lukeslp/steam-network-data) repository.

## Tech Stack

- **D3.js v7** — Force simulation, zoom, and rendering
- **Canvas 2D** — High-performance rendering for 82K+ nodes
- **Vanilla JavaScript** — No framework dependencies

## License

MIT
