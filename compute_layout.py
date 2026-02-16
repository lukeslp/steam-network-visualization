"""
Genre-aware force-directed layout for Steam co-review network.

Two-phase layout:
  Phase 1: Position genre cluster centers in a circle, sized by node count.
           Hub node (highest degree) per genre anchors the cluster.
  Phase 2: Spring layout with hub positions fixed, so nodes settle
           around their genre's hub while cross-genre edges pull
           related clusters toward each other.

Also produces a trimmed steam_network.json for browser visualization
(filters to edges >= MIN_WEIGHT, removes isolated nodes).

Usage:
    python3 compute_layout.py [--full-only]   # --full-only skips trimmed network output
"""

import json
import math
import time
import sys
from pathlib import Path
from collections import Counter, defaultdict

try:
    import networkx as nx
    import numpy as np
    from networkx.algorithms import community
except ImportError:
    print("ERROR: networkx and numpy required.")
    print("  pip install networkx numpy")
    sys.exit(1)

# ── Config ──────────────────────────────────────────────────────────
HERE = Path(__file__).parent
NETWORK_FULL = HERE / 'steam_network_full.json'
NETWORK_VIZ = HERE / 'steam_network.json'
LAYOUT_OUT = HERE / 'steam_force_layout.json'

# Edge weight threshold — edges below this are excluded from viz + layout
MIN_WEIGHT = 40

# Layout parameters
ITERATIONS = 100        # More iterations for better genre separation
K_SPRING = 0.8          # Spring constant — higher = more spread within clusters
SEED = 42

# Genre layout circle radius (in layout units, normalized later)
GENRE_CIRCLE_RADIUS = 4.0

# Minimum genre size to get its own cluster (smaller genres merge into "Other")
MIN_GENRE_SIZE = 15


def main():
    full_only = '--full-only' in sys.argv

    t0 = time.time()
    print("=" * 60)
    print("Steam Network — Genre-Aware Layout Generator")
    print("=" * 60)

    # 1. Load full network
    source = NETWORK_FULL if NETWORK_FULL.exists() else NETWORK_VIZ
    print(f"\n[1/7] Loading network from {source.name}...")
    with open(source) as f:
        data = json.load(f)

    nodes = data['nodes']
    links = data['links']
    meta = data.get('meta', {})
    genre_names = meta.get('genres', [])
    print(f"  {len(nodes):,} nodes, {len(links):,} links")

    # 2. Build graph with filtered edges
    print(f"\n[2/7] Building graph (min weight={MIN_WEIGHT})...")
    G = nx.Graph()

    for i, node in enumerate(nodes):
        G.add_node(i,
                   title=node['title'],
                   reviews=node.get('reviews', 0),
                   genres=node.get('genres', []))

    edge_count = 0
    for link in links:
        if link['weight'] >= MIN_WEIGHT:
            G.add_edge(link['source'], link['target'], weight=link['weight'])
            edge_count += 1

    # Remove isolated nodes
    isolates = list(nx.isolates(G))
    G.remove_nodes_from(isolates)
    connected_nodes = set(G.nodes())

    print(f"  {G.number_of_nodes():,} nodes, {G.number_of_edges():,} edges")
    print(f"  ({len(isolates):,} isolated nodes removed)")

    # 2.5. Community Detection (Louvain)
    print(f"\n[2.5/7] Detecting communities (Louvain algorithm)...")
    t_comm = time.time()
    communities = community.louvain_communities(G, seed=SEED)
    comm_time = time.time() - t_comm

    # Build node → community mapping
    node_community = {}
    for comm_id, comm_nodes in enumerate(communities):
        for n in comm_nodes:
            node_community[n] = comm_id

    # Community statistics
    comm_sizes = Counter(node_community.values())
    comm_sizes_sorted = sorted(comm_sizes.items(), key=lambda x: -x[1])

    print(f"  Found {len(communities)} communities in {comm_time:.1f}s")
    print(f"  Size distribution: min={min(comm_sizes.values())}, max={max(comm_sizes.values())}, "
          f"median={sorted(comm_sizes.values())[len(comm_sizes)//2]}")
    print(f"  Top 5 largest communities:")
    for comm_id, size in comm_sizes_sorted[:5]:
        print(f"    Community {comm_id}: {size:,} nodes")

    # Analyze genre diversity within communities
    comm_genre_diversity = {}
    for comm_id in range(len(communities)):
        comm_nodes_set = [n for n in G.nodes() if node_community[n] == comm_id]
        comm_genres = []
        for n in comm_nodes_set:
            genres = G.nodes[n].get('genres', [])
            if genres:
                comm_genres.append(genres[0])
        genre_dist = Counter(comm_genres)
        # Calculate diversity (normalized entropy)
        total = sum(genre_dist.values())
        if total > 0:
            entropy = -sum((c/total) * math.log(c/total) for c in genre_dist.values() if c > 0)
            max_entropy = math.log(len(genre_dist)) if len(genre_dist) > 1 else 1
            diversity = entropy / max_entropy if max_entropy > 0 else 0
        else:
            diversity = 0
        comm_genre_diversity[comm_id] = diversity

    avg_diversity = sum(comm_genre_diversity.values()) / len(comm_genre_diversity) if comm_genre_diversity else 0
    print(f"  Genre diversity within communities: avg={avg_diversity:.2f} (0=homogeneous, 1=uniform)")

    # 3. Assign primary genre and find hubs
    print(f"\n[3/7] Computing genre clusters...")

    # Primary genre for each node (first genre in list, or -1)
    node_genre = {}
    genre_node_counts = Counter()
    for n in G.nodes():
        genres = G.nodes[n].get('genres', [])
        pg = genres[0] if genres else -1
        node_genre[n] = pg
        genre_node_counts[pg] += 1

    # Merge small genres into "Other" (genre index -1)
    small_genres = {g for g, c in genre_node_counts.items() if c < MIN_GENRE_SIZE and g != -1}
    for n in G.nodes():
        if node_genre[n] in small_genres:
            node_genre[n] = -1
    genre_node_counts = Counter(node_genre.values())

    # Sort genres by node count (largest first) for circle placement
    genre_order = sorted(genre_node_counts.keys(), key=lambda g: -genre_node_counts[g])

    print(f"  {len(genre_order)} genre clusters:")
    for g in genre_order:
        name = genre_names[g] if 0 <= g < len(genre_names) else "Other"
        print(f"    {name}: {genre_node_counts[g]:,} nodes")

    # Find hub (highest degree) per genre
    genre_hub = {}
    for g in genre_order:
        genre_nodes = [n for n in G.nodes() if node_genre[n] == g]
        hub = max(genre_nodes, key=lambda n: G.degree(n))
        genre_hub[g] = hub
        hub_title = G.nodes[hub]['title']
        hub_deg = G.degree(hub)
        name = genre_names[g] if 0 <= g < len(genre_names) else "Other"
        print(f"    {name} hub: {hub_title} (degree {hub_deg})")

    # 4. Position genre centers in a circle
    print(f"\n[4/7] Positioning genre centers...")

    # Place genres in a circle, angle proportional to cumulative node count
    total_nodes = sum(genre_node_counts.values())
    genre_center = {}
    angle = 0
    for g in genre_order:
        frac = genre_node_counts[g] / total_nodes
        mid_angle = angle + (frac * math.pi)  # center of this genre's arc
        gx = GENRE_CIRCLE_RADIUS * math.cos(mid_angle)
        gy = GENRE_CIRCLE_RADIUS * math.sin(mid_angle)
        genre_center[g] = (gx, gy)
        angle += frac * 2 * math.pi

    # 5. Compute layout with genre-aware initial positions
    print(f"\n[5/7] Computing spring layout ({ITERATIONS} iterations)...")
    print(f"  Hub nodes are position-fixed; others settle around genre centers.")

    rng = np.random.RandomState(SEED)

    # Initial positions: nodes near their genre center + jitter
    init_pos = {}
    for n in G.nodes():
        g = node_genre[n]
        cx, cy = genre_center[g]
        # Spread within cluster scales with sqrt of cluster size
        spread = 0.3 * math.sqrt(genre_node_counts[g] / 100)
        jx = rng.normal(0, spread)
        jy = rng.normal(0, spread)
        init_pos[n] = np.array([cx + jx, cy + jy])

    # Fix hub positions exactly at genre centers
    fixed_nodes = list(genre_hub.values())
    for g, hub in genre_hub.items():
        init_pos[hub] = np.array(genre_center[g])

    t1 = time.time()

    pos = nx.spring_layout(
        G,
        pos=init_pos,
        fixed=fixed_nodes,
        k=K_SPRING / math.sqrt(G.number_of_nodes()),
        iterations=ITERATIONS,
        seed=SEED,
        weight='weight',
    )

    layout_time = time.time() - t1
    print(f"  Layout computed in {layout_time:.1f}s")

    # 6. Normalize and write output
    print(f"\n[6/7] Normalizing positions...")

    # 7. Write output with community data
    print(f"\n[7/7] Writing output files...")

    # Percentile-based normalization to [0, 1]
    all_x = sorted(float(xy[0]) for xy in pos.values())
    all_y = sorted(float(xy[1]) for xy in pos.values())
    n = len(all_x)
    p_lo, p_hi = 0.01, 0.99
    x_lo = all_x[int(n * p_lo)]
    x_hi = all_x[int(n * p_hi)]
    y_lo = all_y[int(n * p_lo)]
    y_hi = all_y[int(n * p_hi)]
    x_range = x_hi - x_lo or 1
    y_range = y_hi - y_lo or 1
    margin = 0.02

    layout_output = {
        'positions': {},
        'communities': {},
        'meta': {
            'node_count': G.number_of_nodes(),
            'edge_count': G.number_of_edges(),
            'min_weight': MIN_WEIGHT,
            'iterations': ITERATIONS,
            'layout_time_seconds': round(layout_time, 1),
            'genre_clusters': len(genre_order),
            'num_communities': len(communities),
            'algorithm': 'genre-aware spring_layout',
            'community_detection': 'louvain',
        }
    }

    for node_idx, (x, y) in pos.items():
        node_id = nodes[node_idx]['id']
        nx_val = (float(x) - x_lo) / x_range * (1 - 2 * margin) + margin
        ny_val = (float(y) - y_lo) / y_range * (1 - 2 * margin) + margin
        nx_val = max(0.0, min(1.0, nx_val))
        ny_val = max(0.0, min(1.0, ny_val))
        layout_output['positions'][node_id] = [round(nx_val, 6), round(ny_val, 6)]
        layout_output['communities'][node_id] = node_community[node_idx]

    with open(LAYOUT_OUT, 'w') as f:
        json.dump(layout_output, f, separators=(',', ':'))

    layout_size = LAYOUT_OUT.stat().st_size / (1024 * 1024)
    print(f"  Layout: {LAYOUT_OUT.name} ({layout_size:.1f} MB, {G.number_of_nodes():,} positions)")

    # Write trimmed network for browser visualization
    if not full_only:
        # Build index mapping: old node index → new node index
        old_to_new = {}
        trimmed_nodes = []
        for old_idx in sorted(connected_nodes):
            new_idx = len(trimmed_nodes)
            old_to_new[old_idx] = new_idx
            trimmed_nodes.append(nodes[old_idx])

        trimmed_links = []
        for link in links:
            if link['weight'] >= MIN_WEIGHT:
                s = old_to_new.get(link['source'])
                t = old_to_new.get(link['target'])
                if s is not None and t is not None:
                    trimmed_links.append({
                        'source': s,
                        'target': t,
                        'weight': link['weight']
                    })

        trimmed_data = {
            'nodes': trimmed_nodes,
            'links': trimmed_links,
            'meta': {
                **meta,
                'node_count': len(trimmed_nodes),
                'link_count': len(trimmed_links),
                'min_edge_weight': MIN_WEIGHT,
                'trimmed_from': f'{len(nodes)} nodes, {len(links)} links',
                'description': meta.get('description', '') + f' (trimmed: weight>={MIN_WEIGHT})',
            }
        }

        with open(NETWORK_VIZ, 'w') as f:
            json.dump(trimmed_data, f, separators=(',', ':'))

        viz_size = NETWORK_VIZ.stat().st_size / (1024 * 1024)
        print(f"  Network: {NETWORK_VIZ.name} ({viz_size:.1f} MB, {len(trimmed_nodes):,} nodes, {len(trimmed_links):,} links)")

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"Total time: {elapsed:.0f}s ({elapsed/60:.1f} min)")
    print("=" * 60)


if __name__ == '__main__':
    main()
