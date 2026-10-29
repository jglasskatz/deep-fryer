#!/usr/bin/env python3
"""Standalone, deterministic Matplotlib figures from the archived evidence bundle.

No fitted trends, interpolation, imputation, causal estimates or country quotas.
Requires matplotlib==3.6.2; all plotted coordinates come from portrait-series.json.
"""
import datetime as dt
import json
import os
import pathlib

os.environ.setdefault('MPLCONFIGDIR', '/tmp/deep-fryer-matplotlib')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Wedge, Circle

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / 'data/portrait-series.json').read_text())
FIGURES = ROOT / 'figures'
FIGURES.mkdir(exist_ok=True)
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 12,
                     'svg.fonttype': 'none', 'svg.hashsalt': 'argentina-20261029',
                     'axes.spines.top': False, 'axes.spines.right': False,
                     'axes.labelcolor': '#153a42', 'text.color': '#153a42',
                     'axes.edgecolor': '#839396', 'grid.color': '#dbe3e3'})
TEAL, RED, GREY = '#007b73', '#bc404c', '#52666b'

def rows(indicator):
    return sorted([r for r in DATA['observations'] if r['indicator_id'] == indicator], key=lambda r:r['period_start'])

def decimal_date(value):
    date = dt.date.fromisoformat(value)
    return date.year + (date - dt.date(date.year, 1, 1)).days / (366 if date.year % 4 == 0 else 365)

def midpoint(row):
    return (decimal_date(row['period_start']) + decimal_date(row['period_end'])) / 2

def save(fig, name, description):
    fig.savefig(FIGURES / (name + '.svg'), bbox_inches='tight', facecolor='white',
                metadata={'Date': None, 'Description': description})
    plt.close(fig)

def series(ax, indicator, color, label):
    previous = None
    for row in rows(indicator):
        if row['value'] is None or row['epistemic_type'] == 'projection':
            previous = None
            continue
        x, y = midpoint(row), row['value']
        adjacent = previous and (dt.date.fromisoformat(row['period_start']) - dt.date.fromisoformat(previous['period_end'])).days == 1
        if adjacent and previous['comparability_group'] == row['comparability_group'] and not row['break_flags']:
            ax.plot([midpoint(previous), x], [previous['value'], y], color=color, lw=1.6)
        # Horizontal bars show the observation interval, not an event-day measurement.
        ax.plot([decimal_date(row['period_start']), decimal_date(row['period_end'])], [y, y], color=color, alpha=.35, lw=2)
        ax.plot(x, y, 'o', color=color, ms=3.8)
        if row.get('confidence_interval'):
            lo, hi = row['confidence_interval']
            ax.errorbar(x, y, yerr=[[y-lo], [hi-y]], color=color, capsize=3, lw=1)
        previous = row
    ax.plot([], [], color=color, marker='o', ms=4, label=label)

fig, ax = plt.subplots(figsize=(9, 4.3), layout='constrained')
series(ax, 'poverty', TEAL, 'Income poverty')
series(ax, 'indigence', RED, 'Food-basket indigence')
for date, label in [('2019-12-10', 'Fernández takes office'), ('2023-12-10', 'Milei takes office')]:
    x = decimal_date(date)
    ax.axvline(x, color=GREY, lw=.8, ls='--')
    ax.text(x+.08, 59, label, rotation=90, va='top', fontsize=10, color=GREY)
ax.set(xlim=(2016, 2027.4), ylim=(0, 61), ylabel='People below the income line (%)', xlabel='Observation period (midpoints with period bars)')
ax.set_xticks([2016, 2018, 2020, 2022, 2024, 2026])
ax.grid(axis='y', alpha=.7)
ax.legend(loc='upper left', frameon=False)
ax.annotate('32.3%\nH1 2026*', (2026.25, 32.3), (2026.55, 37), fontsize=11, color=TEAL)
ax.annotate('7.5%', (2026.25, 7.5), (2026.55, 11), fontsize=11, color=RED)
save(fig, 'poverty-history', 'INDEC urban poverty and indigence, H2 2016 to H1 2026. Latest values provisional. Supplied 90% intervals only. Gaps in lines preserve source coverage changes. Events do not identify effects.')

fig, axes = plt.subplots(1, 3, figsize=(9, 3.6), layout='constrained')
sectors = [('life_expectancy', 74, 'Life expectancy'), ('electricity_access', 95, 'Electricity'), ('employment', 94, 'Employment'), ('equality', 70, 'Urban equality (H2)')]
for ax, year in zip(axes, [2013, 2023, 2024]):
    for index, (indicator, target, label) in enumerate(sectors):
        row = next(r for r in rows(indicator) if r['observation_year'] == year and r['value'] is not None)
        gap = max(0, 1-row['value']/target)
        start, end = 90-index*90-87, 90-index*90-3
        ax.add_patch(Wedge((0,0), 1, start, end, width=.16, color='#cfe4c8'))
        if gap:
            ax.add_patch(Wedge((0,0), .84, start, end, width=.84*min(gap,1), color=RED))
        angle = (start+end)/2
        import math
        ax.text(.53*math.cos(math.radians(angle)), .53*math.sin(math.radians(angle)), f'{gap*100:.1f}%', ha='center', va='center', fontsize=11)
    ax.text(0, 1.15, str(year), ha='center', weight='bold', fontsize=13)
    ax.set(xlim=(-1.1,1.1), ylim=(-1.25,1.35), aspect='equal')
    ax.axis('off')
fig.text(.5, .01, 'Clockwise from top: life expectancy · electricity · employment · urban equality (H2)', ha='center', fontsize=11)
save(fig, 'partial-social-doughnuts', 'Four-sector social benchmark adaptation. Green band is the fixed benchmark; inward red extent and labels are shortfall relative to that benchmark. No ecological or overall score. Equality is urban H2 survey; 2013 statistics carry comparability cautions.')

fig, axes = plt.subplots(2, 2, figsize=(9, 5.7), layout='constrained')
specs = [
    ('co2_territorial_per_capita','Fossil and cement CO₂','t CO₂ / person / year',(0,6)),
    ('forest_area','Forest stock share','% of land area',(16.5,18.5)),
    ('pm25','Population-weighted PM2.5','µg/m³',(10,18)),
    ('material_footprint','Material footprint, empirical window','tonnes / person / year',(10,20)),
]
for ax, (indicator, title, unit, limits) in zip(axes.flat, specs):
    series(ax, indicator, TEAL, 'Territorial' if indicator.startswith('co2') else 'Published estimate')
    if indicator.startswith('co2'):
        series(ax, 'co2_consumption_per_capita', RED, 'Consumption')
        ax.legend(loc='lower left', fontsize=10, frameon=False)
    ax.axvline(decimal_date('2023-12-10'), color=GREY, lw=.8, ls='--')
    ax.set(title=title, ylabel=unit, xlim=(2013,2027), ylim=limits)
    ax.set_xticks([2013,2016,2019,2023,2026])
    ax.grid(axis='y', alpha=.7)
    ax.tick_params(labelsize=10)
save(fig, 'ecological-evidence', 'Native-unit ecological estimates with common time axis, separate y-scales and no national quota. Dashed line marks 10 December 2023 only. Material values after 2019 excluded because projected inputs enter. Carbon accounts use preliminary accessed GCB workbook.')
print('Wrote three standalone SVG figures from the evidence bundle.')
