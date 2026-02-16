"""
Build co-review network from the artermiloff Steam Reviews 2024 dataset.

128M reviews across 80K games (one CSV per game), 2012 through June 2024.
Scraped via Steamworks "User Reviews - Get List" API.

Memory optimization strategy:
  - Only scan games with 50+ reviews (30K files cover 99.5% of review volume)
  - Store steamids as int (saves ~40 bytes each vs string)
  - Store app_ids as int
  - Periodic pruning: remove single-game users every N files
  - Two-pass: scan to build user_games, then edge computation

CSV columns (0-indexed):
  14: author_steamid

Output: steam_network.json
"""

import csv
import json
import gc
import sys
import time
from collections import defaultdict
from itertools import combinations
from pathlib import Path
import re

# -- Configuration ----------------------------------------------------------

DATA_DIR = Path('/home/coolhand/html/datavis/data_trove/entertainment/gaming')
REVIEWS_DIR = DATA_DIR / 'reviews_2024' / 'SteamReviews2024'
ENRICHED_CSV = DATA_DIR / 'enriched' / 'games.csv'
OUTPUT = Path(__file__).parent / 'steam_network.json'

MIN_YEAR = 2005
TOP_K = 50
MIN_SHARED = 5
MAX_USER_GAMES = 75
MIN_GAME_REVIEWS = 50     # Only scan games with this many reviews (99.5% coverage)
PRUNE_INTERVAL = 5000     # Prune single-game users every N files
STEAMID_COL = 14

# -- Game metadata ----------------------------------------------------------

def load_game_metadata():
    """Load game metadata from enriched CSV. Returns dict: app_id(str) -> info dict."""
    COL = {
        'app_id': 0, 'name': 1, 'release_date': 2, 'price': 6,
        'positive': 23, 'negative': 24, 'genres': 36, 'tags': 37,
        'developers': 33,
    }

    games = {}
    with open(ENRICHED_CSV, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        next(reader)
        for row in reader:
            if len(row) < 38:
                continue
            app_id = row[COL['app_id']]
            date_str = row[COL['release_date']]
            m = re.search(r'(\d{4})', date_str) if date_str else None
            if not m:
                continue
            year = int(m.group(1))
            if year < MIN_YEAR or year > 2025:
                continue
            try:
                positive = int(row[COL['positive']])
                negative = int(row[COL['negative']])
            except (ValueError, IndexError):
                continue
            reviews = positive + negative
            if reviews < 1:
                continue
            ratio = round(100 * positive / reviews)
            r = positive / reviews
            if r >= 0.95 and reviews >= 500:
                rating = 'Overwhelmingly Positive'
            elif r >= 0.80 and reviews >= 50:
                rating = 'Very Positive'
            elif r >= 0.70:
                rating = 'Mostly Positive'
            elif r >= 0.40:
                rating = 'Mixed'
            elif r >= 0.20:
                rating = 'Mostly Negative'
            elif reviews >= 500:
                rating = 'Overwhelmingly Negative'
            elif reviews >= 50:
                rating = 'Very Negative'
            else:
                rating = 'Negative'
            try:
                price = float(row[COL['price']])
            except (ValueError, IndexError):
                price = 0.0
            games[app_id] = {
                'title': row[COL['name']].strip(),
                'year': str(year),
                'rating': rating,
                'ratio': ratio,
                'reviews': reviews,
                'price': price,
            }
    return games


# -- Review scanning (memory-optimized) ------------------------------------

def scan_reviews(target_ids_str):
    """Scan per-game CSVs for games in target_ids_str.

    Uses int keys throughout to minimize memory.
    Periodically prunes users who reviewed only 1 game.

    Returns: dict mapping int(steamid) -> set(int(app_id))
    Only users with 2+ games are kept.
    """
    t0 = time.time()
    # Convert target IDs to set for O(1) lookup (filenames are numeric strings)
    target_set = set(target_ids_str)

    # user_games: int(steamid) -> set(int(app_id))
    user_games = defaultdict(set)
    total_reviews = 0
    files_processed = 0
    files_skipped = 0

    csv_files = sorted(REVIEWS_DIR.glob('*.csv'))
    total_files = len(csv_files)
    print(f"Scanning {total_files:,} files (filtering to {len(target_set):,} target games)...")

    for csv_path in csv_files:
        app_id_str = csv_path.stem
        if app_id_str not in target_set:
            files_skipped += 1
            continue

        files_processed += 1
        app_id_int = int(app_id_str)

        try:
            with open(csv_path, 'r', encoding='utf-8', errors='replace') as f:
                reader = csv.reader(f)
                next(reader, None)
                for row in reader:
                    if len(row) > STEAMID_COL and row[STEAMID_COL]:
                        try:
                            sid = int(row[STEAMID_COL])
                            user_games[sid].add(app_id_int)
                            total_reviews += 1
                        except ValueError:
                            pass
        except Exception as e:
            print(f"  Warning: {csv_path.name}: {e}")

        # Progress + periodic pruning
        if files_processed % PRUNE_INTERVAL == 0:
            elapsed = time.time() - t0
            before = len(user_games)
            # Remove users who reviewed only 1 game so far
            user_games = defaultdict(set, {
                k: v for k, v in user_games.items() if len(v) >= 2
            })
            pruned = before - len(user_games)
            print(f"  ...{files_processed:,}/{total_files:,} files "
                  f"({files_skipped:,} skipped), {total_reviews:,} reviews, "
                  f"{len(user_games):,} multi-game users "
                  f"(pruned {pruned:,} single-game) ({elapsed:.0f}s)")
            gc.collect()

    # Final prune
    user_games = defaultdict(set, {
        k: v for k, v in user_games.items() if len(v) >= 2
    })

    elapsed = time.time() - t0
    print(f"Done: {files_processed:,} files, {total_reviews:,} reviews, "
          f"{len(user_games):,} multi-game users ({elapsed:.0f}s)")

    return user_games


def build_edge_weights(user_games, id_to_reviews_int):
    """Build weighted edges from co-review mapping.

    Uses int app_ids throughout. Returns dict: (int, int) -> weight.
    """
    t0 = time.time()
    edge_weights = defaultdict(int)
    multi_game_users = 0
    capped_users = 0

    print(f"\nBuilding edge weights from {len(user_games):,} multi-game users...")

    for steamid, games_set in user_games.items():
        multi_game_users += 1

        if len(games_set) > MAX_USER_GAMES:
            capped_users += 1
            games_list = sorted(
                games_set,
                key=lambda x: id_to_reviews_int.get(x, 0),
                reverse=True
            )[:MAX_USER_GAMES]
        else:
            games_list = sorted(games_set)

        for a, b in combinations(games_list, 2):
            pair = (a, b) if a < b else (b, a)
            edge_weights[pair] += 1

        if multi_game_users % 500_000 == 0:
            elapsed = time.time() - t0
            print(f"  ...{multi_game_users:,} users, "
                  f"{len(edge_weights):,} pairs ({elapsed:.0f}s)")

            if len(edge_weights) > 15_000_000:
                before = len(edge_weights)
                edge_weights = defaultdict(int, {
                    k: v for k, v in edge_weights.items() if v >= 3
                })
                print(f"    Pruned: {before:,} -> {len(edge_weights):,}")

        if len(edge_weights) > 100_000_000:
            print(f"  ABORT: {len(edge_weights):,} edges")
            return None

    elapsed = time.time() - t0
    print(f"{multi_game_users:,} users processed ({elapsed:.0f}s)")
    if capped_users:
        print(f"  ({capped_users:,} capped at {MAX_USER_GAMES} games)")
    print(f"{len(edge_weights):,} unique pairs")

    return edge_weights


def apply_top_k_filter(edge_weights, k=TOP_K):
    """Top-K neighbor filter with MIN_SHARED floor."""
    t0 = time.time()
    print(f"\nApplying top-{k} filter (MIN_SHARED={MIN_SHARED})...")

    filtered = {p: w for p, w in edge_weights.items() if w >= MIN_SHARED}
    print(f"  MIN_SHARED={MIN_SHARED}: {len(filtered):,} edges "
          f"(dropped {len(edge_weights) - len(filtered):,})")

    adj = defaultdict(list)
    for (a, b), w in filtered.items():
        adj[a].append((b, w))
        adj[b].append((a, w))

    top_k_pairs = set()
    for node, neighbors in adj.items():
        neighbors.sort(key=lambda x: x[1], reverse=True)
        for other, w in neighbors[:k]:
            pair = (node, other) if node < other else (other, node)
            top_k_pairs.add(pair)

    final = {p: filtered[p] for p in top_k_pairs if p in filtered}
    elapsed = time.time() - t0
    print(f"  top-{k}: {len(final):,} edges, "
          f"{len(adj):,} nodes ({elapsed:.1f}s)")

    return final


def print_edge_distribution(edge_weights):
    thresholds = [3, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
    print("\n  Edge distribution:")
    for t in thresholds:
        c = sum(1 for w in edge_weights.values() if w >= t)
        if c == 0:
            break
        print(f"    >= {t:>5}: {c:>10,}")


def build_output(final_edges, game_meta):
    """Build network JSON. Converts int app_ids back to strings for output."""
    connected = set()
    for a, b in final_edges:
        connected.add(str(a))
        connected.add(str(b))

    id_to_idx = {}
    nodes = []
    for app_id_str in sorted(connected):
        meta = game_meta.get(app_id_str)
        if not meta:
            continue
        id_to_idx[app_id_str] = len(nodes)
        nodes.append({
            'id': app_id_str,
            'title': meta['title'],
            'year': meta['year'],
            'rating': meta['rating'],
            'ratio': meta['ratio'],
            'reviews': meta['reviews'],
            'price': meta['price'],
        })

    links = []
    for (a, b), w in final_edges.items():
        a_str, b_str = str(a), str(b)
        if a_str in id_to_idx and b_str in id_to_idx:
            links.append({
                'source': id_to_idx[a_str],
                'target': id_to_idx[b_str],
                'weight': w,
            })

    links.sort(key=lambda l: l['weight'], reverse=True)
    max_w = links[0]['weight'] if links else 0
    min_w = links[-1]['weight'] if links else 0

    return {
        'nodes': nodes,
        'links': links,
        'meta': {
            'description': 'Steam co-review network (128M reviews, 2012-2024)',
            'node_count': len(nodes),
            'link_count': len(links),
            'min_edge_weight': min_w,
            'max_edge_weight': max_w,
            'top_k': TOP_K,
            'min_shared': MIN_SHARED,
            'max_user_games': MAX_USER_GAMES,
            'min_game_reviews': MIN_GAME_REVIEWS,
            'data_source': 'artermiloff/steam-games-reviews-2024',
        }
    }


def main():
    t_start = time.time()
    print("=" * 60)
    print("Steam Co-Review Network v2 (memory-optimized)")
    print(f"TOP_K={TOP_K}, MIN_SHARED={MIN_SHARED}, "
          f"MAX_USER_GAMES={MAX_USER_GAMES}, MIN_GAME_REVIEWS={MIN_GAME_REVIEWS}")
    print("=" * 60)

    # 1. Load game metadata
    print("\n[1/4] Loading game metadata...")
    game_meta = load_game_metadata()
    print(f"  {len(game_meta):,} games with metadata")

    # Filter to games with enough reviews
    target_ids = {
        aid for aid, m in game_meta.items()
        if m['reviews'] >= MIN_GAME_REVIEWS
    }
    print(f"  {len(target_ids):,} games with >= {MIN_GAME_REVIEWS} reviews")

    # Review count lookup (int keys for memory efficiency in edge building)
    id_to_reviews_int = {int(aid): m['reviews'] for aid, m in game_meta.items()}

    # 2. Scan reviews
    print(f"\n[2/4] Scanning review files...")
    user_games = scan_reviews(target_ids)

    # Free metadata memory before edge computation
    del target_ids
    gc.collect()

    # 3. Build edges
    print(f"\n[3/4] Building edges...")
    edge_weights = build_edge_weights(user_games, id_to_reviews_int)

    # Free user_games before filtering
    del user_games
    gc.collect()

    if edge_weights is None:
        print("ERROR: Edge computation exploded.")
        sys.exit(1)

    print_edge_distribution(edge_weights)

    # 4. Filter and output
    print(f"\n[4/4] Filtering and writing...")
    final_edges = apply_top_k_filter(edge_weights, k=TOP_K)

    del edge_weights
    gc.collect()

    network = build_output(final_edges, game_meta)

    with open(OUTPUT, 'w') as f:
        json.dump(network, f, separators=(',', ':'))

    elapsed = time.time() - t_start
    size_mb = OUTPUT.stat().st_size / (1024 * 1024)

    print(f"\n{'=' * 60}")
    print(f"Saved: {OUTPUT}")
    print(f"  {network['meta']['node_count']:,} nodes, "
          f"{network['meta']['link_count']:,} links")
    print(f"  Weight: {network['meta']['min_edge_weight']:,} - "
          f"{network['meta']['max_edge_weight']:,}")
    print(f"  Size: {size_mb:.1f} MB")
    print(f"  Time: {elapsed:.0f}s ({elapsed/60:.1f} min)")
    print("=" * 60)


if __name__ == '__main__':
    main()
