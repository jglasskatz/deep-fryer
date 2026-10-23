import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generalSEPack } from '@keel_flow/pack-general-se';

const check = generalSEPack.principles.find(p => p.id === 'gate-is-reproducible').check;
function violations(value) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'deep-fryer-keel-path-'));
  try {
    writeFileSync(path.join(cwd, 'evidence.json'), JSON.stringify(value));
    return check({ cwd, diff: { files: [{ path: 'evidence.json', status: 'added' }] } });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}
test('Keel accepts public HTTP source paths without disabling filesystem checks', () => {
  const linux = ['', 'home', 'researcher', 'evidence.png'].join('/');
  const mac = ['', 'Users', 'researcher', 'evidence.png'].join('/');
  const source = 'https://www.countyofmonterey.gov/home/showpublisheddocument/12345';
  assert.deepEqual(violations({ source, other: `http://example.gov${mac}` }), []);
  assert.equal(violations({ source, local: linux }).length, 1, 'Same-line local path must still fail');
  assert.equal(violations({ local: mac, source }).length, 1, 'Local path before URL must still fail');
  assert.equal(violations({ text: `${source}\\n${linux}` }).length, 1, 'Escaped newline cannot extend URL exemption');
  assert.equal(violations({ text: `${source}\" + \"${linux}` }).length, 1, 'Concatenated strings cannot extend URL exemption');
  assert.equal(violations({ local: mac })[0].severity, 'critical');
  assert.equal(violations({ local: `file://${linux}` }).length, 1, 'File URLs are local paths');
  assert.equal(violations({ text: `https:// ${linux}` }).length, 1, 'Malformed HTTP prefix cannot hide a path');
});
