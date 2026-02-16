"""
Build Steam game data from the fronkongames Kaggle dataset (122K games, Jan 2026).

Uses the fronkongames CSV as the PRIMARY data source (not a join with our old CSV).
This gives us games through 2025, with genres, tags, developer, publisher, and
review counts directly from the dataset.

Output:
  - steam_all_2005.json: All games 2005-2025 with genres/tags/developer
  - Updates steam_network.json: Adds genre/tags to network nodes

The fronkongames CSV has a header bug: "DiscountDLC count" is actually two
columns (Discount, DLC count), so all columns from index 8+ are offset by 1.
We handle this by reading raw rows and using corrected indices.
"""

import csv
import json
import re
import time
from collections import Counter
from datetime import datetime
from pathlib import Path

DATA_DIR = Path('/home/coolhand/html/datavis/data_trove/entertainment/gaming')
ENRICHED_CSV = DATA_DIR / 'enriched' / 'games.csv'
OUTPUT_DIR = Path(__file__).parent

# Column indices in the fronkongames CSV (corrected for header bug)
# Header merges "Discount" and "DLC count" into "DiscountDLC count",
# so from index 8 onward everything is shifted +1 from what headers say.
COL = {
    'app_id': 0,
    'name': 1,
    'release_date': 2,
    'estimated_owners': 3,
    'peak_ccu': 4,
    'required_age': 5,
    'price': 6,
    'discount': 7,
    'dlc_count': 8,
    'about': 9,
    'supported_languages': 10,
    'full_audio_languages': 11,
    'reviews': 12,
    'header_image': 13,
    'website': 14,
    'support_url': 15,
    'support_email': 16,
    'windows': 17,
    'mac': 18,
    'linux': 19,
    'metacritic_score': 20,
    'metacritic_url': 21,
    'user_score': 22,
    'positive': 23,
    'negative': 24,
    'score_rank': 25,
    'achievements': 26,
    'recommendations': 27,
    'notes': 28,
    'avg_playtime_forever': 29,
    'avg_playtime_2weeks': 30,
    'median_playtime_forever': 31,
    'median_playtime_2weeks': 32,
    'developers': 33,
    'publishers': 34,
    'categories': 35,
    'genres': 36,
    'tags': 37,
    'screenshots': 38,
    'movies': 39,
}

# Steam's rating categories based on positive ratio and total reviews
RATINGS_LIST = [
    'Overwhelmingly Positive', 'Very Positive', 'Mostly Positive',
    'Positive', 'Mixed', 'Mostly Negative', 'Negative',
    'Very Negative', 'Overwhelmingly Negative'
]


def safe_int(val, default=0):
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


def safe_float(val, default=0.0):
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def parse_date(date_str):
    """Parse 'Aug 1, 2023' or 'Aug 2023' into year. Returns None on failure."""
    if not date_str:
        return None
    m = re.search(r'(\d{4})', date_str)
    if m:
        return int(m.group(1))
    return None


def compute_rating(positive, negative):
    """Compute Steam-style rating category from review counts.

    Returns (rating_string, rating_index) tuple.
    Uses Steam's approximate thresholds.
    """
    total = positive + negative
    if total == 0:
        return 'Mixed', 4

    ratio = positive / total

    if ratio >= 0.95 and total >= 500:
        return 'Overwhelmingly Positive', 0
    elif ratio >= 0.80 and total >= 50:
        return 'Very Positive', 1
    elif ratio >= 0.70:
        return 'Mostly Positive', 2
    elif ratio >= 0.80:
        # Small sample but positive
        return 'Positive', 3
    elif ratio >= 0.40:
        return 'Mixed', 4
    elif ratio >= 0.20:
        return 'Mostly Negative', 5
    elif total >= 500:
        return 'Overwhelmingly Negative', 8
    elif total >= 50:
        return 'Very Negative', 7
    else:
        return 'Negative', 6


def load_all_games():
    """Load ALL games from the fronkongames dataset as primary source.

    Returns list of game dicts sorted by review count (descending).
    Only includes games from 2005+ with at least 1 review.
    """
    t0 = time.time()
    print(f"Loading games from {ENRICHED_CSV}...")

    games = []
    skipped_year = 0
    skipped_reviews = 0
    skipped_short = 0
    total = 0

    with open(ENRICHED_CSV, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        next(reader)  # Skip header

        for row in reader:
            total += 1
            if len(row) < 38:
                skipped_short += 1
                continue

            year = parse_date(row[COL['release_date']])
            if not year or year < 2005 or year > 2025:
                skipped_year += 1
                continue

            positive = safe_int(row[COL['positive']])
            negative = safe_int(row[COL['negative']])
            reviews = positive + negative
            if reviews < 1:
                skipped_reviews += 1
                continue

            ratio = round(100 * positive / reviews) if reviews > 0 else 0
            _, rating_idx = compute_rating(positive, negative)
            price = safe_float(row[COL['price']])

            genres_raw = row[COL['genres']] if len(row) > COL['genres'] else ''
            tags_raw = row[COL['tags']] if len(row) > COL['tags'] else ''
            genres = [g.strip() for g in genres_raw.split(',') if g.strip()] if genres_raw else []
            tags = [t.strip() for t in tags_raw.split(',') if t.strip()] if tags_raw else []

            developer = row[COL['developers']].strip() if len(row) > COL['developers'] else ''

            games.append({
                'app_id': row[COL['app_id']],
                'name': row[COL['name']].strip(),
                'year': year,
                'ratio': ratio,
                'reviews': reviews,
                'price': price,
                'rating_idx': rating_idx,
                'genres': genres,
                'tags': tags,
                'developer': developer,
                'positive': positive,
                'negative': negative,
            })

    games.sort(key=lambda g: g['reviews'], reverse=True)
    elapsed = time.time() - t0

    print(f"  Total rows: {total:,}")
    print(f"  Loaded: {len(games):,} games (2005-2025 with reviews)")
    print(f"  Skipped: {skipped_year:,} (wrong year), {skipped_reviews:,} (no reviews), {skipped_short:,} (short rows)")
    print(f"  Completed in {elapsed:.1f}s")

    return games


def build_all_games_json(games):
    """Build steam_all_2005.json from the full game list.

    Array per game: [name, year, ratio, reviews, price, ratingIdx, genreIdxs, tagIdxs, developer]
    """
    t0 = time.time()

    # Build genre index (sorted by frequency)
    genre_freq = Counter()
    for g in games:
        for genre in g['genres']:
            genre_freq[genre] += 1

    genre_list = [g for g, _ in genre_freq.most_common()]
    genre_to_idx = {g: i for i, g in enumerate(genre_list)}

    # Build tag index (top 50 most common, using top 5 tags per game)
    tag_freq = Counter()
    for g in games:
        for tag in g['tags'][:5]:
            tag_freq[tag] += 1

    tag_list = [t for t, _ in tag_freq.most_common(50)]
    tag_to_idx = {t: i for i, t in enumerate(tag_list)}

    genre_matched = 0
    games_out = []

    for g in games:
        genre_indices = [genre_to_idx[gen] for gen in g['genres'] if gen in genre_to_idx]
        tag_indices = [tag_to_idx[t] for t in g['tags'][:5] if t in tag_to_idx]

        if genre_indices:
            genre_matched += 1

        games_out.append([
            g['name'],
            g['year'],
            g['ratio'],
            g['reviews'],
            g['price'],
            g['rating_idx'],
            genre_indices,
            tag_indices,
            g['developer'],
        ])

    # Year distribution for reporting
    year_dist = Counter(g['year'] for g in games)

    output = {
        'ratings': RATINGS_LIST,
        'genres': genre_list,
        'tags': tag_list,
        'games': games_out,
        'meta': {
            'count': len(games_out),
            'yearRange': [2005, 2025],
            'genre_matched': genre_matched,
            'source': 'fronkongames/steam-games-dataset (Jan 2026)',
        }
    }

    outpath = OUTPUT_DIR / 'steam_all_2005.json'
    with open(outpath, 'w') as f:
        json.dump(output, f, separators=(',', ':'))

    size_mb = outpath.stat().st_size / (1024 * 1024)
    elapsed = time.time() - t0

    print(f"\n  Wrote {outpath.name}: {len(games_out):,} games, {size_mb:.1f} MB")
    print(f"  {genre_matched:,} games with genre data ({100*genre_matched/len(games_out):.1f}%)")
    print(f"  {len(genre_list)} unique genres, {len(tag_list)} tags indexed")
    print(f"  Year distribution:")
    for y in sorted(year_dist.keys()):
        print(f"    {y}: {year_dist[y]:,}")
    print(f"  Completed in {elapsed:.1f}s")

    return genre_list, tag_list


def build_enriched_lookup(games):
    """Build a lookup dict keyed by app_id for network enrichment."""
    return {g['app_id']: g for g in games}


def update_network_json(lookup, genre_list, tag_list):
    """Add genre/tag info to steam_network.json nodes."""
    t0 = time.time()
    net_path = OUTPUT_DIR / 'steam_network.json'

    with open(net_path, 'r') as f:
        net = json.load(f)

    genre_to_idx = {g: i for i, g in enumerate(genre_list)}
    tag_to_idx = {t: i for i, t in enumerate(tag_list)}

    matched = 0
    for node in net['nodes']:
        app_id = node.get('id', '')
        g = lookup.get(app_id)
        if g:
            matched += 1
            node['genres'] = [genre_to_idx[gen] for gen in g['genres'] if gen in genre_to_idx]
            node['tags'] = [tag_to_idx[t] for t in g['tags'][:5] if t in tag_to_idx]
            node['developer'] = g['developer']
            # Update review counts from fresh data
            if g['reviews'] > node.get('reviews', 0):
                node['reviews'] = g['reviews']
                node['ratio'] = g['ratio']
        else:
            node['genres'] = []
            node['tags'] = []
            node['developer'] = ''

    # Add genre/tag lookup tables to meta
    net['meta']['genres'] = genre_list
    net['meta']['tags'] = tag_list

    with open(net_path, 'w') as f:
        json.dump(net, f, separators=(',', ':'))

    size_mb = net_path.stat().st_size / (1024 * 1024)
    elapsed = time.time() - t0
    print(f"\n  Updated {net_path.name}: {matched:,}/{len(net['nodes']):,} nodes enriched")
    print(f"  File size: {size_mb:.1f} MB")
    print(f"  Completed in {elapsed:.1f}s")


def main():
    print("=" * 60)
    print("Steam Data Build Pipeline (fronkongames primary)")
    print("=" * 60)

    # 1. Load ALL games from fronkongames dataset
    games = load_all_games()

    # 2. Build all-games JSON
    print("\nBuilding all-games JSON...")
    genre_list, tag_list = build_all_games_json(games)

    # 3. Update network JSON with genres/tags
    print("\nUpdating network JSON with genres/tags...")
    lookup = build_enriched_lookup(games)
    update_network_json(lookup, genre_list, tag_list)

    print("\n" + "=" * 60)
    print("Build complete!")
    print("=" * 60)


if __name__ == '__main__':
    main()
