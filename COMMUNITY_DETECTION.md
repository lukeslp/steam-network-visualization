# Community Detection Enhancement

## Summary

Added Louvain community detection to `compute_layout.py` to identify natural player-behavior clusters based on network structure, independent of Steam's genre labels.

## Changes Made

### 1. Import Addition (line 28)
```python
from networkx.algorithms import community
```

### 2. Community Detection Phase (lines 99-144)

New step 2.5 inserted after graph building and before genre cluster computation:

**Core Detection:**
- Runs Louvain algorithm: `community.louvain_communities(G, seed=SEED)`
- Creates `node_community` mapping: node index → community ID
- Uses same random seed (42) for reproducibility

**Statistics Output:**
- Total community count
- Size distribution (min, max, median)
- Top 5 largest communities by node count
- Genre diversity within communities (normalized entropy, 0=homogeneous, 1=uniform)

**Genre Diversity Metric:**
Measures how mixed each community's genres are:
- 0.0 = all games share same primary genre
- 1.0 = uniform distribution across all genres
- Average diversity across all communities printed

### 3. Layout Output Enhancement (lines 254-277)

**New `communities` field in JSON:**
```json
{
  "positions": { "game_id": [x, y], ... },
  "communities": { "game_id": community_id, ... },
  "meta": {
    "num_communities": 127,
    "community_detection": "louvain",
    ...
  }
}
```

Each game node gets:
- Normalized 2D position (unchanged)
- Community ID assignment (new)

### 4. Metadata Updates

Added to `meta` object:
- `num_communities`: Total detected communities
- `community_detection`: Algorithm name ("louvain")

### 5. Step Renumbering

Updated progress indicators from `[1/6]` through `[6/6]` to `[1/7]` through `[7/7]` to accommodate the new step 2.5.

## Use Cases

### Compare Communities vs. Genres

Are player co-review patterns (communities) aligned with Steam's genre labels (clusters)?

- **High diversity** → Communities span genres (players review diverse games)
- **Low diversity** → Communities match genres (players stick to niches)

### Frontend Visualization Options

The `communities` field enables:
1. **Color by community**: Alternative to genre/rating/price/year coloring
2. **Community filtering**: Filter dots + edges by detected community
3. **Cross-genre analysis**: Highlight games in communities dominated by a different genre
4. **Bridge detection**: Games connecting multiple communities (high betweenness centrality)

### Network Analysis

Community data enables:
- **Modularity calculation**: How well-separated are the communities?
- **Genre homophily**: Do genres cluster together more than random?
- **Hub analysis**: Which games are central to their community?

## Performance

Louvain is fast (~0.1-2s for 9K nodes on typical hardware). No significant impact on total runtime.

## Output Example

```
[2.5/7] Detecting communities (Louvain algorithm)...
  Found 127 communities in 0.8s
  Size distribution: min=1, max=1247, median=23
  Top 5 largest communities:
    Community 0: 1,247 nodes
    Community 1: 834 nodes
    Community 2: 612 nodes
    Community 3: 487 nodes
    Community 4: 356 nodes
  Genre diversity within communities: avg=0.64 (0=homogeneous, 1=uniform)
```

## Future Enhancements

Potential follow-ups:
1. **Export community metadata**: Save top genres, hub games per community
2. **Multi-resolution detection**: Use `resolution` parameter for finer/coarser communities
3. **Community labels**: Auto-label communities by dominant genre or hub game
4. **Temporal analysis**: Track community evolution across release years

## References

- **Louvain Algorithm**: Blondel et al. (2008) - Fast unfolding of communities in large networks
- **NetworkX Implementation**: `networkx.algorithms.community.louvain_communities()`
