"""Allocate each shared dimension session once across its researched portraits."""
from pathlib import Path
import json

root = Path(__file__).resolve().parent
planned = json.loads((root / 'task-list.json').read_text())
records = {row['dimension']: json.loads((root / 'activity' / (row['dimension'] + '.json')).read_text()) for row in planned}
metrics = ['web_tool_calls', 'search_queries', 'url_open_attempts', 'evidence_capture_attempts', 'evidence_capture_successes', 'evidence_capture_failures']
totals = {key: 0 for key in metrics}
allocated = {key: 0 for key in metrics}
for dimension, record in records.items():
    assert record['model'] == 'gpt-6.1-sol' and record['reasoning_effort'] == 'medium', dimension
    for key in metrics:
        value = record.get(key, 0)
        assert isinstance(value, (int, float)) and value >= 0, (dimension, key)
        totals[key] += value
for slug in ['carmel', 'monterey-county']:
    parts = []
    counts = {key: 0 for key in metrics}
    for dimension, record in records.items():
        row = next(item for item in planned if item['dimension'] == dimension)
        portraits = record.get('portraits_researched', row['portraits'])
        assert set(portraits) == set(row['portraits']), dimension
        if slug not in portraits:
            continue
        weight = 1 / len(portraits)
        parts.append({'dimension': dimension, 'activity_path': 'activity/' + dimension + '.json', 'allocated_fraction': weight})
        for key in metrics:
            counts[key] += record.get(key, 0) * weight
    for key in metrics:
        allocated[key] += counts[key]
    activity = {'model': 'gpt-6.1-sol', 'reasoning_effort': 'medium', 'portrait': slug,
                'dimension_sessions': parts, **counts, 'actual_tokens': None, 'actual_billed_usd': None,
                'allocation_note': 'Shared dimension-session counts are allocated equally across their researched portraits; totals count every session once. Fractions are accounting allocations, not fractional tool calls. Raw per-session counters and search records are retained. Failed attempts are included when recorded. API search charges are only modeled from web-tool-call proxies. Capture and URL counters retain the definitions recorded by each session; separately logged generated exhibits or direct acquisitions are preserved in raw logs rather than inferred into these totals.'}
    (root / slug / 'activity.json').write_text(json.dumps(activity, indent=2) + '\n')
assert totals == allocated, (totals, allocated)
print(json.dumps({'dimension_sessions': len(records), 'unique_recorded_totals': totals}))
