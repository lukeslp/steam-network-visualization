# Genre vs Community Toggle - Implementation Summary

## Overview
Added a "Group by" toggle to the Network tab that allows switching between Genre-based and Community-based node coloring. This reveals the disconnect between Steam's official genre taxonomy and actual player-behavior networks detected through co-review patterns.

## Changes Made

### 1. force.js Updates

#### State Variables (lines 30-42)
- Added `groupMode = 'genre'` - tracks current grouping mode ('genre' | 'community')
- Added `communitiesData = null` - stores nodeId → community index mapping
- Added `numCommunities = 0` - number of detected communities

#### Data Loading (lines 67-80)
- Modified `loadAndBuild()` to load community data from `steam_force_layout.json`
- Added version bump to v=5 to force cache refresh
- Logs community count if data available, warns if missing

#### Node Coloring (lines 282-296)
- Added `getNodeColor(node)` function that:
  - Returns HSL color based on community ID when in 'community' mode (uses golden angle 137.5° for even hue distribution)
  - Falls back to genre-based coloring from `window._steamData.getGameColor()` when in 'genre' mode
- Updated `render()` to use `getNodeColor(node)` instead of direct color lookup

#### Public API (lines 889-906)
- Added `setGroupMode(mode)` - switches between 'genre' and 'community', warns if community data unavailable
- Added `getGroupMode()` - returns current mode
- Added `hasCommunitiesData()` - returns true if community data loaded
- Added `getNumCommunities()` - returns number of communities

### 2. index.html Updates

#### UI Controls (lines 722-745)
Added "Group by" section at top of Network controls:
```html
<span class="controls-section-label">Group by</span>
<div class="pill-row" id="net-group-mode">
    <button class="pill active" data-mode="genre">Genre</button>
    <button class="pill" data-mode="community">Community</button>
</div>
<div id="net-group-legend" style="margin-top:3px;font-size:0.5rem;color:#666;"></div>
```

#### JavaScript (buildNetworkControlsUI)
- Added event listeners for group mode toggle pills
- Checks if community data available before switching to 'community' mode
- Shows warning tooltip "⚠️ Community data not available. Run compute_layout.py to generate." if data missing
- Calls `updateNetworkLegend()` after mode switch

#### Legend Updates (updateNetworkLegend)
New function that dynamically updates the legend based on mode:
- **Genre mode**: Shows top 6 genres with color dots (e.g., "● Action · ● Adventure · ● Indie...")
- **Community mode**: Shows community count (e.g., "47 communities detected by co-review patterns")

Made `updateNetworkLegend()` globally accessible via `window.updateNetworkLegend`

## Data Requirements

The feature requires `communities` object in `steam_force_layout.json`:
```json
{
  "positions": { "1000010": [0.506, 0.140], ... },
  "communities": { "1000010": 3, "1000030": 12, ... },
  "meta": {
    "num_communities": 47,
    "community_detection": "louvain",
    ...
  }
}
```

### Generating Community Data

Run the existing `compute_layout.py` script (already has community detection code):
```bash
cd /home/coolhand/html/datavis/interactive/steam
python3 compute_layout.py
```

This will:
1. Load `steam_network_full.json` (or `steam_network.json`)
2. Build NetworkX graph with edges ≥ MIN_WEIGHT (40)
3. Run Louvain community detection
4. Output updated `steam_force_layout.json` with communities data
5. Log community statistics (size distribution, genre diversity within communities)

Expected output includes lines like:
```
[2.5/7] Detecting communities (Louvain algorithm)...
  Found 47 communities in 2.3s
  Size distribution: min=15, max=892, median=124
  Genre diversity within communities: avg=0.68 (0=homogeneous, 1=uniform)
```

## Color Scheme

### Genre Mode
Uses existing Steam genre colors from `window._steamData.getGameColor()` (matches scatter plot colors)

### Community Mode
- HSL colors with 70% saturation, 60% lightness
- Hue calculated using golden angle (137.5°) for visually distinct colors
- Formula: `hsl((commId * 137.5) % 360, 70%, 60%)`
- Ensures even distribution across color wheel (related to Fibonacci spacing)

## User Experience

1. **Default State**: Genre mode active, shows genre colors
2. **Switching to Community**:
   - If data available: Nodes recolor instantly, legend updates to show community count
   - If data missing: Shows orange warning tooltip for 3 seconds, stays in genre mode
3. **Legend Feedback**:
   - Genre mode: Top 6 genres with color dots
   - Community mode: "N communities detected by co-review patterns"

## Research Value

This toggle reveals:
- **Genre alignment**: Do communities align with Steam's genre labels?
- **Market segmentation**: Player behavior may segment differently than official categories
- **Cross-genre appeal**: Communities spanning multiple genres indicate games with broad appeal
- **Niche clusters**: Tight communities within genres reveal specialized subcommunities

Low genre diversity within communities (avg < 0.5) suggests Steam's taxonomy captures player behavior well. High diversity (avg > 0.7) suggests player-behavior networks transcend genre boundaries.

## Files Modified

1. `/home/coolhand/html/datavis/interactive/steam/force.js` - Core visualization logic
2. `/home/coolhand/html/datavis/interactive/steam/index.html` - UI controls and legend

## Testing Checklist

- [x] Syntax valid (node -c force.js passes)
- [ ] Genre mode displays correctly
- [ ] Switching to community mode without data shows warning
- [ ] Switching to community mode with data recolors nodes
- [ ] Legend updates correctly for both modes
- [ ] Colors are visually distinct in community mode
- [ ] Performance is acceptable with 9K+ nodes

## Next Steps

1. Run `compute_layout.py` to generate community data
2. Test in browser at https://dr.eamer.dev/datavis/interactive/steam/
3. Verify warning appears when community data missing
4. After data generation, verify community colors display correctly
5. Compare genre vs community views to analyze alignment
