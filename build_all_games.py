"""
Extract ALL Steam games from 2005+ into a compact JSON for the multi-view visualization.
Uses packed arrays for minimal file size.

Output format:
{
  "ratings": ["Overwhelmingly Positive", "Very Positive", ...],  // rating index lookup
  "games": [[title, year, ratio, reviews, price, ratingIdx, win, mac, linux, deck], ...],
  "meta": { "count": N, "yearRange": [min, max] }
}
"""

import csv
import json
from pathlib import Path

DATA_DIR = Path('/home/coolhand/html/datavis/data_trove/entertainment/gaming')
OUTPUT = Path(__file__).parent / 'steam_all_2005.json'

MIN_YEAR = 2005

RATING_ORDER = [
    'Overwhelmingly Positive',
    'Very Positive',
    'Mostly Positive',
    'Positive',
    'Mixed',
    'Mostly Negative',
    'Negative',
    'Very Negative',
    'Overwhelmingly Negative',
]


def main():
    rating_to_idx = {r: i for i, r in enumerate(RATING_ORDER)}
    games = []

    with open(DATA_DIR / 'games.csv', 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            year_str = row.get('date_release', '')[:4]
            if not year_str:
                continue
            try:
                year = int(year_str)
            except ValueError:
                continue
            if year < MIN_YEAR:
                continue

            try:
                reviews = int(row['user_reviews'])
            except (ValueError, KeyError):
                continue

            ratio = int(row.get('positive_ratio', 0))
            price = round(float(row.get('price_final', 0)), 2)
            rating = row.get('rating', 'Mixed')
            ri = rating_to_idx.get(rating, 4)  # default to Mixed

            win = 1 if row.get('win', '').lower() == 'true' else 0
            mac = 1 if row.get('mac', '').lower() == 'true' else 0
            linux = 1 if row.get('linux', '').lower() == 'true' else 0
            deck = 1 if row.get('steam_deck', '').lower() == 'true' else 0

            title = row.get('title', 'Unknown')
            # Truncate very long titles
            if len(title) > 60:
                title = title[:57] + '...'

            games.append([title, year, ratio, reviews, price, ri, win, mac, linux, deck])

    # Sort by reviews descending for initial render priority
    games.sort(key=lambda g: g[3], reverse=True)

    years = [g[1] for g in games]
    output = {
        'ratings': RATING_ORDER,
        'games': games,
        'meta': {
            'count': len(games),
            'yearRange': [min(years), max(years)],
        }
    }

    with open(OUTPUT, 'w') as f:
        json.dump(output, f, separators=(',', ':'))

    size_kb = OUTPUT.stat().st_size / 1024
    print(f'Exported {len(games)} games to {OUTPUT}')
    print(f'File size: {size_kb:.1f} KB')
    print(f'Year range: {min(years)}-{max(years)}')


if __name__ == '__main__':
    main()
