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
        assert.match(i.source_url, /^https:\/\/zenodo.org\/records\/17540639\/files\//);
        assert.ok(i.source_url && i.source);
        assert.equal(i.value, i.report_verification.score_text === 'No Overshoot' ? 'No overshoot' : `${i.level_pct}%`);
        assert.equal(i.target, null, 'Native targets must not qualify imported percentage headlines');
        assert.equal(i.source_worksheet.definition, i.legacy_record.description);
        assert.notEqual(i.notes, i.legacy_record.description, 'Native definitions must not define the score');
        assert.equal(i.status, 'source-supported-draft');
        assert.ok(existsSync(`site/${i.evidence_path}`));
        assert.ok(existsSync(`site/${i.pdf_path}`));
        assert.equal(i.report_verification.approved, false);
        assert.equal(i.imported_percentage.value, i.legacy_record[ring === 'social' ? 'shortfall_pct' : 'overshoot_pct']);
        assert.ok(Number.isFinite(i.level_pct));
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
    ['Voter Turnout', '40%', '60%', '100%'],
    ['Racial Equity Index', '40%', '60', '100'],
    ['Police Scorecard', '65%', '35%', '100%'],
    ['Income Inequality', '100%', '0%', '100%'],
    ['Transportation (Transit Report Card)', '40%', '6', '10'],
    ['Renewable Electricity', '62%', '38%', '100%'],
    ['Forest Cover', '28%', '27%', '37.5%'],
  ]) {
    const i = named(name);
    assert.equal(i.value, score);
    assert.equal(i.report_measurement.value, native);
    assert.equal(i.source_worksheet.target, target);
    assert.equal(i.legacy_record.target, target);
    assert.equal(i.target, null);
    assert.match(i.value_label, /^Report (shortfall|overshoot)$/);
    assert.match(i.notes, /not the native measurement/);
    assert.equal(i.source_worksheet.definition, i.legacy_record.description);
  }
  const vegetables = named('Vegetables per Day');
  assert.equal(vegetables.value, '40.8%');
  assert.equal(vegetables.source_worksheet.value, null, 'Original omission remains archived');
  assert.equal(vegetables.report_measurement.value, '59.2%', 'Read directly from PDF p84, not inferred');
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
  for (const [name, native, pct, corrected] of [['Protected Area', '25.2% / 16.2%', 503, 59], ['Ozone-Depleting Substances', 'Yes', 0, 0]]) {
    assert.equal(named(name).report_measurement.value, native);
    assert.equal(named(name).imported_percentage.value, pct);
    assert.equal(named(name).level_pct, corrected);
    assert.equal(named(name).report_verification.page, 85);
  }
  assert.equal(named('Ozone Layer').unit, '');
  assert.equal(named('Ozone Layer').report_measurement.unit, 'Dobson Units');
  assert.match(named('Ozone Layer').geography, /Global observation/);
  assert.match(named('Homelessness').quality_flags.join(' '), /not the percentage of Californians/);
  assert.equal(named('Homelessness').source_worksheet.value, null);
  assert.equal(named('Homelessness').report_measurement.value, '0.47%');
  assert.equal(named('Poverty').year, '2021-2023');
  assert.match(named('Forest Cover').quality_flags.join(' '), /2022\?/);

});

test('report restores missing scores, explicit no-overshoot is zero, positive scores never look safe', () => {
  assert.deepEqual(indicators.filter(i => i.level_pct === null), []);
  for (const name of ['Ozone-Depleting Substances', 'Ozone Layer']) {
    assert.equal(named(name).level_pct, 0);
    assert.equal(named(name).value, 'No overshoot');
    assert.equal(named(name).report_verification.score_text, 'No Overshoot');
  }
  assert.equal(named('Protected Area').level_pct, 59);
  assert.equal(named('At-Risk Species').level_pct, 947);
  for (const d of portrait.dimensions) {
    const values = d.indicators.map(i => i.level_pct);
    assert.equal(d.level, pctToVizLevel(values.reduce((a, b) => a + b, 0) / values.length));
    assert.equal(dimensionState(d), d.slug === 'ozone-depletion' ? 'within' : 'outside');
    assert.equal(dimensionColour(d), d.slug === 'ozone-depletion' ? '#8cd755' : null);
  }
});

test('all 42 report table scores, native values, targets and measured periods match the transcription', () => {
  const audit = json('site/imports/california/report-audit.json');
  const expectedScores = [16.9,40,28,46,19.6,7,40,12.9,11.4,40.8,32.5,53,35.9,55,15.4,9.3,99.9,65,40,16,100,26,2.2,0.6,60,60,59,947,65,13,1890,62,63,76,28,351,209,657,91,520,0,0];
  assert.deepEqual(audit.indicators.map(i => i.score_pct), expectedScores);
  assert.equal(new Set(audit.indicators.map(i => i.name)).size, 42);
  assert.equal(audit.report.md5, 'fa91f14fe71eeae586cdc1d6d12616b0');
  assert.equal(audit.report.pages, 95);
  assert.equal(audit.indicators.filter(i => i.score_comparison === 'verified-match').length, 37);
  assert.equal(audit.indicators.filter(i => i.score_comparison === 'rounding').length, 1);
  assert.equal(audit.indicators.filter(i => i.score_comparison === 'missing-or-fallback').length, 4);
  assert.equal(audit.indicators.filter(i => i.native_comparison === 'omitted').length, 7);
  for (const [ring, average, outside] of [['social', 34, 24], ['ecological', 286, 16]]) {
    const values = audit.indicators.filter(i => i.ring === ring).map(i => i.score_pct);
    assert.equal(Math.round(values.reduce((a, b) => a + b, 0) / values.length), average, 'Report summary mean reproduces');
    assert.equal(values.filter(v => v > 0).length, outside, 'Report count of breached indicators reproduces');
  }
  for (const report of audit.indicators) {
    const i = named(report.name);
    assert.equal(i.level_pct, report.score_pct);
    assert.deepEqual(i.report_measurement, report.measurement);
    assert.equal(i.report_measurement.target, i.source_worksheet.target);
    assert.equal(i.report_measurement.unit, i.source_worksheet.unit);
    assert.equal(String(i.year), report.measurement.period);
    assert.equal(i.report_verification.page, report.ring === 'social' ? 84 : 85);
  }
  assert.equal(named('Sanitation Access').level_pct, 0.6);
  assert.equal(named('Sanitation Access').legacy_record.shortfall_pct, 0.57);
});

test('release preserves all 11 pre-import portraits exactly and reproduces California', () => {
  const release = publicRelease();
  assert.equal(release.portraits.length, 12);
  const preserved = release.portraits.filter(p => p.slug !== 'california');
  assert.equal(preserved.length, 11);
  // Canonical JSON of the 11 baseline portraits before the import: main c7798c74
  // plus the reviewed Santa Cruz housing and equity corrections in 9f6705e.
  assert.equal(createHash('sha256').update(JSON.stringify(preserved)).digest('hex'), '2632e299d929409c5b2daed94aa7701dbcdebd7c1c5c7c58e2989890d0a485aa');
  assert.deepEqual(release.portraits.find(p => p.slug === 'california'), JSON.parse(JSON.stringify(portrait)));
  validateRelease(release);
  for (const mutate of [
    p => p.dimensions[0].indicators.pop(),
    p => { p.dimensions[0].indicators[0].value = 123; },
    p => { p.provenance.approved = true; },
    p => { p.dimensions.find(d => d.slug === 'ozone-depletion').level = 1; },
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
  assert.deepEqual(californiaSourceFiles.toSorted(), ['manifest.json', 'doughnut.json', 'raw_social.csv', 'raw_ecological.csv', 'report-audit.json'].toSorted());
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
