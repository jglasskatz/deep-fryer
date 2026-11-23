import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = path.join(ROOT, 'migrations');

describe('migration 0028_multi_provider_keys contract', () => {
  it('widens organization_api_keys to composite PK (organization_id, provider) and preserves ciphertext isolation', () => {
    const sql = readFileSync(path.join(MIGRATIONS, '0028_multi_provider_keys.sql'), 'utf8');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "provider" text DEFAULT 'anthropic' NOT NULL/);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS "organization_api_keys_provider"/);
    expect(sql).toMatch(/CHECK \("organization_api_keys"\."provider" IN \('anthropic', 'openai', 'google'\)\)/);
    expect(sql).toMatch(/PRIMARY KEY\("organization_id","provider"\)/);
    expect(sql).toMatch(/REVOKE SELECT ON organization_api_keys FROM deep_fryer_app/);
    expect(sql).toMatch(
      /GRANT SELECT \(organization_id, provider, key_hint, created_by, created_at, validated_at\)\s+ON organization_api_keys TO deep_fryer_app/,
    );
    expect(sql).not.toMatch(/GRANT SELECT \([^)]*ciphertext[^)]*\)/i);
  });

  it('links meta/_journal.json (idx 28) and meta/0028_snapshot.json cleanly from 0027', () => {
    const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {
      entries: Array<{ idx: number; when: number; tag: string }>;
    };
    const prevJournal = journal.entries.find((e) => e.idx === 27);
    const currJournal = journal.entries.find((e) => e.idx === 28);
    expect(prevJournal?.tag).toBe('0027_session_checkpointing');
    expect(currJournal?.tag).toBe('0028_multi_provider_keys');
    expect(currJournal!.when).toBeGreaterThan(prevJournal!.when);

    const snap27 = JSON.parse(readFileSync(path.join(MIGRATIONS, 'meta/0027_snapshot.json'), 'utf8')) as {
      id: string;
    };
    const snap28 = JSON.parse(readFileSync(path.join(MIGRATIONS, 'meta/0028_snapshot.json'), 'utf8')) as {
      id: string;
      prevId: string;
      tables: Record<
        string,
        {
          columns: Record<string, { primaryKey: boolean }>;
          compositePrimaryKeys: Record<string, { columns: string[] }>;
          checkConstraints: Record<string, { value: string }>;
        }
      >;
    };
    expect(snap28.prevId).toBe(snap27.id);
    expect(snap28.id).not.toBe(snap27.id);

    const table = snap28.tables['public.organization_api_keys']!;
    expect(table.columns.organization_id!.primaryKey).toBe(false);
    expect(table.compositePrimaryKeys.organization_api_keys_organization_id_provider_pk!.columns).toEqual([
      'organization_id',
      'provider',
    ]);
    expect(table.checkConstraints.organization_api_keys_provider!.value).toContain("'openai'");
    expect(table.checkConstraints.organization_api_keys_provider!.value).toContain("'google'");
  });
});
