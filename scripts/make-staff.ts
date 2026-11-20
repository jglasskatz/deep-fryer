#!/usr/bin/env tsx
/**
 * Give an account staff access, take it away, or list who has it. Staff set
 * contract plans and quotas on billing pages. The person signs in to the app
 * first; this command then changes the account they signed in with and
 * records the change in the audit log (packages/db staff.ts).
 *
 *   tsx scripts/make-staff.ts --email you@example.org
 *   tsx scripts/make-staff.ts --email you@example.org --revoke
 *   tsx scripts/make-staff.ts --list
 *
 * On a deployed host, through the ops shell (docs/deploy.md §4):
 *   docker compose run --rm migrate node --import tsx ../../scripts/make-staff.ts --email you@example.org
 */
import { getDb, listStaff, setStaff, StaffChangeRefused } from '@deep-fryer/db';

const USAGE = [
  'Usage:',
  '  make-staff --email <address>            give the account signed in with <address> staff access',
  '  make-staff --email <address> --revoke   take staff access away from it',
  '  make-staff --list                       list everyone with staff access',
].join('\n');

type Command = { kind: 'set'; email: string; on: boolean } | { kind: 'list' };

/** The command asked for, or null when the arguments do not make one. */
function parseArgs(argv: string[]): Command | null {
  let email: string | undefined;
  let revoke = false;
  let list = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--email') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) return null;
      email = value.trim();
    } else if (arg?.startsWith('--email=')) {
      email = arg.slice('--email='.length).trim();
    } else if (arg === '--revoke') {
      revoke = true;
    } else if (arg === '--list') {
      list = true;
    } else {
      return null;
    }
  }
  if (list) return email === undefined && !revoke ? { kind: 'list' } : null;
  if (!email) return null;
  return { kind: 'set', email, on: !revoke };
}

async function main(): Promise<number> {
  const command = parseArgs(process.argv.slice(2));
  if (!command) {
    console.error(USAGE);
    return 1;
  }
  const db = getDb();

  if (command.kind === 'list') {
    const staff = await listStaff(db);
    if (staff.length === 0) {
      console.log('No one has staff access yet. Sign in to the app, then run: make-staff --email <your address>');
      return 0;
    }
    console.log(`${staff.length} ${staff.length === 1 ? 'person has' : 'people have'} staff access:`);
    for (const person of staff) {
      const since = person.grantedAt ? `, since ${person.grantedAt.toISOString().slice(0, 10)}` : '';
      const name = person.name ? ` (${person.name})` : '';
      console.log(`  ${person.email ?? '(account with no address)'}${name}${since}`);
    }
    return 0;
  }

  try {
    const result = await setStaff(db, command.email, command.on, { via: 'make-staff' });
    if (!result.changed) {
      console.log(command.on ? `${result.email} already has staff access.` : `${result.email} does not have staff access.`);
    } else if (command.on) {
      console.log(`${result.email} now has staff access. It takes effect on their next page load; the change is in the audit log.`);
    } else {
      console.log(`${result.email} no longer has staff access. The change is in the audit log.`);
    }
    return 0;
  } catch (err) {
    if (err instanceof StaffChangeRefused) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
