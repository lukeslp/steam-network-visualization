# Community Detection Quick Reference

## What Was Added

Community detection using the Louvain algorithm to identify natural player-behavior clusters.

## Key Code Additions

### 1. Import (line 28)
```python
from networkx.algorithms import community
```

### 2. Detection (lines 99-144)
```python
# Run Louvain
communities = community.louvain_communities(G, seed=SEED)

# Build mapping
node_community = {}
for comm_id, comm_nodes in enumerate(communities):
    for n in comm_nodes:
        node_community[n] = comm_id

# Stats
comm_sizes = Counter(node_community.values())
print(f"Found {len(communities)} communities")
print(f"Top 5 largest: ...")

# Genre diversity per community (normalized entropy)
comm_genre_diversity = {}
for comm_id in range(len(communities)):
    # ... calculate entropy-based diversity metric
    # 0 = all same genre, 1 = uniform across genres
```

### 3. Output Format (lines 254-277)
```python
layout_output = {
    'positions': {},
    'communities': {},  # NEW
    'meta': {
        'num_communities': len(communities),  # NEW
        'community_detection': 'louvain',     # NEW
        ...
    }
}

# Add community ID for each node
layout_output['communities'][node_id] = node_community[node_idx]
```

## Output JSON Structure

```json
{
  "positions": {
    "220": [0.456, 0.789],
    "440": [0.123, 0.456],
    ...
  },
  "communities": {
    "220": 0,
    "440": 1,
    ...
  },
  "meta": {
    "node_count": 9527,
    "edge_count": 144328,
    "num_communities": 127,
    "community_detection": "louvain",
    ...
  }
}
```

## Console Output

```
[2.5/7] Detecting communities (Louvain algorithm)...
  Found 127 communities in 0.8s
  Size distribution: min=1, max=1247, median=23
  Top 5 largest communities:
    Community 0: 1,247 nodes
    Community 1: 834 nodes
    ...
  Genre diversity within communities: avg=0.64 (0=homogeneous, 1=uniform)
```

## Usage

```bash
cd /home/coolhand/html/datavis/interactive/steam
python3 compute_layout.py              # Full output (layout + trimmed network)
python3 compute_layout.py --full-only  # Skip trimmed network generation
```

## Frontend Integration Ideas

1. **Color by community**: Add 4th color mode (Rating, Price, Year, Reviews, **Community**)
2. **Community filter**: Toggle pills for top N communities (like genre filters)
3. **Cross-genre highlighting**: Games in communities dominated by a different genre
4. **Community info panel**: Show community stats on hover/click

## Files Modified

- `compute_layout.py`: Added community detection + export

## Files Created

- `COMMUNITY_DETECTION.md`: Full documentation
- `COMMUNITY_DETECTION_QUICK_REF.md`: This file

## Next Steps

To regenerate layout with community data:

```bash
cd /home/coolhand/html/datavis/interactive/steam
python3 compute_layout.py  # ~2-3 min runtime
```

This will update `steam_force_layout.json` with the new `communities` field.
