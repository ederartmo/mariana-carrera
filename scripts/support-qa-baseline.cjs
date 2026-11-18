'use strict';
// Metadata-only fixture for isolated QA. Never apply to production.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const [mode, snapshotFile] = process.argv.slice(2);
assert.ok(['baseline', 'rate-limit'].includes(mode) && snapshotFile,
  'Usage: node scripts/support-qa-baseline.cjs <baseline|rate-limit> <metadata-only-snapshot.json>');
const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
if (mode === 'rate-limit') {
  const rate = snapshot.functions.find(f => f.name === 'consume_api_rate_limit');
  assert.match(rate?.definition || '', /^CREATE OR REPLACE FUNCTION public\.consume_api_rate_limit\(/i);
  process.stdout.write(read('desc/sql-batch7-rate-limits.sql') + '\n' + rate.definition + ';\n');
} else {
  const table = snapshot.tables.find(t => t.name === 'inscripciones');
  const legacy = JSON.parse(read('tests/fixtures/kinetic-inscripciones-schema.json'));
  const distance = legacy.constraints.find(c => c.name === 'inscripciones_distance_chk');
  assert.ok(table?.columns?.length && distance && table.constraints.some(c => c.name === distance.name));
  const quote = name => { assert.match(name, /^[a-z_][a-z0-9_]*$/); return '"' + name + '"'; };
  const constraints = table.constraints.map(c => c.name === distance.name ? distance : c);
  const columns = table.columns.map(c =>
    quote(c.name) + ' ' + c.type + (c.default === null ? '' : ' DEFAULT ' + c.default) + (c.nullable ? '' : ' NOT NULL'));
  const owned = new Set(constraints.filter(c => /^(PRIMARY KEY|UNIQUE)/.test(c.definition)).map(c => c.name));
  const indexes = table.indexes.filter(i => !owned.has(i.name)).map(i => i.definition + ';');
  process.stdout.write([
    'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA extensions;',
    'CREATE TABLE public.inscripciones (' + [...columns, ...constraints.map(c => 'CONSTRAINT ' + quote(c.name) + ' ' + c.definition)].join(',') + ');',
    ...indexes,
    'ALTER TABLE public.inscripciones ENABLE ROW LEVEL SECURITY;',
    'REVOKE ALL ON public.inscripciones FROM anon, authenticated;',
    'GRANT ALL ON public.inscripciones TO service_role;',
    '',
  ].join('\n'));
}
