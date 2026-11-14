import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { californiaPortrait, californiaSourceFiles, parseWorksheet } from './california-import.mjs';
import { publicRelease } from './research-overlays.mjs';
import { validateRelease } from './pages-contract.mjs';
import { pctToVizLevel } from '../packages/core/src/viz-level.js';
import { dimensionColour, dimensionState } from '../site/portrait-presentation.js';
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const original = json('site/imports/california/doughnut.json');
const portrait = californiaPortrait();
const indicators = portrait.dimensions.flatMap(d => d.indicators);
const named = name => indicators.find(i => i.name === name);

test('all 42 original records and worksheet rows survive without approval', () => {
  assert.equal(portrait.dimensions.length, 21);
  assert.equal(portrait.dimensions.filter(d => d.ring === 'social').length, 12);
  assert.equal(indicators.length, 42);
  assert.equal(portrait.status, 'legacy-source');
  assert.equal(portrait.provenance.approved, false);
  assert.deepEqual(portrait.provenance.legacy_region, original.region);
  for (const ring of ['social', 'ecological']) {
    const rows = parseWorksheet(readFileSync(`site/imports/california/raw_${ring}.csv`, 'utf8'));
    const importedRows = [];
    for (const category of original[ring]) {
      const dimension = portrait.dimensions.find(d => d.slug === category.slug);
      assert.equal(dimension.ring, ring);
      assert.equal(dimension.indicators.length, 2);
      assert.deepEqual(dimension.indicators.map(i => i.legacy_record), category.indicators);
      assert.deepEqual({ ...dimension.legacy_category, indicators: category.indicators }, category);
      assert.deepEqual(dimension.actions, category.actions);
      for (const i of dimension.indicators) {
        assert.equal(i.source_url, i.legacy_record.source_url);
        assert.ok(i.source_url && i.source);
        assert.equal(i.value, i.legacy_record.value);
        assert.equal(i.target, null, 'Native targets must not qualify imported percentage headlines');
        assert.equal(i.source_worksheet.definition, i.legacy_record.description);
        assert.notEqual(i.notes, i.legacy_record.description, 'Native definitions must not define the score');
        assert.equal(i.status, 'legacy-source');
        assert.equal(i.evidence_path, null);
        assert.equal(i.imported_percentage.value, i.legacy_record[ring === 'social' ? 'shortfall_pct' : 'overshoot_pct']);
        assert.equal(i.level_pct, i.imported_percentage.origin === 'category-average-fallback' ? null : i.imported_percentage.value);
        if (i.level_pct !== null) assert.equal(i.unit, '', 'Percentage cannot inherit a native measurement unit');
        importedRows.push(i.worksheet_record);
      }
    }
    const sort = a => a.toSorted((a, b) => a.Abreviation.localeCompare(b.Abreviation));
    assert.deepEqual(sort(importedRows), sort(rows));
  }
});

test('score definitions and native observations remain distinct on inverse scales', () => {
  for (const [name, score, native, target] of [
    ['Gender Pay Gap', '12.9%', '87.1%', '100%'],
    ['Voter Turnout', '40.0%', '60.0%', '100%'],
    ['Racial Equity Index', '40.0%', '60', '100'],
    ['Police Scorecard', '65.0%', '35%', '100%'],
    ['Income Inequality', '100.0%', '0%', '100%'],
    ['Transportation (Transit Report Card)', '40.0%', '6', '10'],
    ['Renewable Electricity', '62%', '38%', '100%'],
    ['Forest Cover', '28%', '27%', '37.5%'],
  ]) {
    const i = named(name);
    assert.equal(i.value, score);
    assert.equal(i.source_worksheet.value, native);
    assert.equal(i.source_worksheet.target, target);
    assert.equal(i.legacy_record.target, target);
    assert.equal(i.target, null);
    assert.match(i.value_label, /^Imported (shortfall|overshoot)$/);
    assert.match(i.notes, /not the native measurement/);
    assert.equal(i.source_worksheet.definition, i.legacy_record.description);
  }
  const vegetables = named('Vegetables per Day');
  assert.equal(vegetables.value, '40.8%');
  assert.equal(vegetables.source_worksheet.value, null, 'Do not infer 59.2% from a shortfall');
  assert.equal(vegetables.source_worksheet.target, '100%');
  assert.match(vegetables.source_worksheet.definition, /adults who eat/);
  for (const i of indicators) {
    assert.equal(i.source_worksheet.value, i.worksheet_record.California || null);
    assert.equal(i.source_worksheet.target, i.worksheet_record.Desirable || null);
  }
});

test('native units, full periods, fallback percentages and limitations stay separate', () => {
  assert.equal(named('Greenhouse Gas Footprint').value, '1890%');
  assert.equal(named('Greenhouse Gas Footprint').source_worksheet.value, '19.6');
  assert.equal(named('Greenhouse Gas Footprint').source_worksheet.unit, 'Tonnes CO2 eq');
  assert.equal(named('Greenhouse Gas Footprint').source_worksheet.target, '0.985');
  assert.equal(named('Poverty').source_worksheet.period, '2021-2023 / 2024');
  assert.equal(named('Literacy Rate').source_worksheet.period, '2017 / 2018?');
  assert.equal(named('Housing Cost Burden').source_worksheet.period, '2018 / 2020?');
  assert.deepEqual(indicators.filter(i => i.imported_percentage.origin === 'category-average-fallback').map(i => i.name).sort(), ['Ozone-Depleting Substances', 'Protected Area']);
  for (const [name, native, pct] of [['Protected Area', '25.2% / 16.2%', 503], ['Ozone-Depleting Substances', 'Yes', 0]]) {
    assert.equal(named(name).value, native);
    assert.equal(named(name).imported_percentage.value, pct);
    assert.match(named(name).value_label, /^Source value/);
    assert.match(named(name).quality_flags.join(' '), /category Average/);
  }
  assert.equal(named('Ozone Layer').unit, 'Dobson Units');
  assert.match(named('Ozone Layer').geography, /Global observation/);
  assert.match(named('Homelessness').quality_flags.join(' '), /not the percentage of Californians/);
  assert.equal(named('Homelessness').source_worksheet.value, null);
});

test('missing scores remain unknown, explicit zero survives, positive scores never look safe', () => {
  assert.deepEqual(indicators.filter(i => i.level_pct === null).map(i => i.name).sort(), ['At-Risk Species', 'Ozone Layer', 'Ozone-Depleting Substances', 'Protected Area']);
  assert.equal(named('Ozone-Depleting Substances').imported_percentage.value, 0);
  assert.equal(named('Ozone-Depleting Substances').level_pct, null);
  for (const d of portrait.dimensions) {
    const values = d.indicators.map(i => i.level_pct);
    if (values.some(v => v === null)) {
      assert.equal(d.level, null);
      assert.equal(dimensionState(d), 'unscored');
      assert.equal(dimensionColour(d), '#777777');
    } else {
      assert.equal(d.level, pctToVizLevel(values.reduce((a, b) => a + b, 0) / values.length));
      assert.ok(d.level > 0);
    }
  }
});

test('release preserves all 11 pre-import portraits exactly and reproduces California', () => {
  const release = publicRelease();
  assert.equal(release.portraits.length, 12);
  const preserved = release.portraits.filter(p => p.slug !== 'california');
  assert.equal(preserved.length, 11);
  // Canonical JSON of the 11 portraits on main c7798c74, before import.
  assert.equal(createHash('sha256').update(JSON.stringify(preserved)).digest('hex'), '3d5dbeb155e104a8724483dc92b1065faf24faf175490fa604cc9339e421af63');
  assert.deepEqual(release.portraits.find(p => p.slug === 'california'), JSON.parse(JSON.stringify(portrait)));
  validateRelease(release);
  for (const mutate of [
    p => p.dimensions[0].indicators.pop(),
    p => { p.dimensions[0].indicators[0].value = 123; },
    p => { p.provenance.approved = true; },
    p => { p.dimensions.find(d => d.slug === 'ozone-depletion').level = 0; },
    p => { p.dimensions[0].indicators[0].source_worksheet.period = '2026'; },
    p => { p.dimensions[0].indicators[0].target = '100%'; },
    p => { p.dimensions[0].indicators[0].source_worksheet.definition = 'Definition of the score'; },
  ]) {
    const modified = structuredClone(release);
    mutate(modified.portraits.find(p => p.slug === 'california'));
    assert.throws(() => validateRelease(modified), /content-bound/);
  }
});

test('the inconsistent legacy example is excluded and source hashes remain pinned', () => {
  assert.deepEqual(californiaSourceFiles.toSorted(), ['manifest.json', 'doughnut.json', 'raw_social.csv', 'raw_ecological.csv'].toSorted());
  assert.equal(existsSync('site/imports/california/california.csv'), false);
  const manifest = json('site/imports/california/manifest.json');
  for (const [name, entry] of Object.entries(manifest.files)) {
    const bytes = readFileSync(`site/imports/california/${name}`);
    assert.equal(bytes.length, entry.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  }
  assert.equal(named('Literacy Rate').level_pct, 28);
  assert.equal(named('Energy Burden').level_pct, 19.6);
  assert.equal(named('Forest Cover').level_pct, 28);
});

test('worksheet parser preserves quoted text and rejects malformed rows', () => {
  assert.deepEqual(parseWorksheet('name,note,date\r\n"A, B","line 1\nline ""2""",2018?\r\n'), [{ name: 'A, B', note: 'line 1\nline "2"', date: '2018?' }]);
  assert.throws(() => parseWorksheet('a,b\n"unclosed'), /Unclosed/);
  assert.throws(() => parseWorksheet('a,b\n1,2,3'), /column mismatch/);
});
