import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

async function loadSource(file) {
  const result = await build({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return module.exports;
}
const { filterSchedules } = await loadSource('src/scheduleFilters.ts');
const { rankedAnalystsForAssay, rollingAssigneeForAssay } = await loadSource('src/PersonnelQualifications.tsx');
const filters = { status: [], assignee: [], protocol: [], product: [], batch: [], test: [] };
const rows = [
  { id: '1', status: 'Scheduled', assignee_id: 'a', trainee_2_id: 'c', protocol_name: 'P1', product_id: 'X', batch_number: 'B1', test_name: 'T1' },
  { id: '2', status: 'Completed', assignee_id: 'b', protocol_name: 'P2', product_id: 'Y', batch_number: 'B2', test_name: 'T2' },
  { id: '3', status: 'Deleted', assignee_id: 'a', protocol_name: 'P1', product_id: 'X', batch_number: 'B1', test_name: 'T1' }
];
test('All resets filters; selections within a field are combined with OR', () => {
  assert.equal(filterSchedules(rows, filters).length, 3);
  assert.deepEqual(filterSchedules(rows, { ...filters, status: ['Scheduled', 'Completed'] }).map(row => row.id), ['1', '2']);
});
test('All six filters combine with AND and analyst matches second trainee', () => {
  assert.deepEqual(filterSchedules(rows, { status: ['Scheduled', 'Completed'], assignee: ['c', 'z'], protocol: ['P1', 'P2'], product: ['X'], batch: ['B1', 'B2'], test: ['T1'] }).map(row => row.id), ['1']);
  assert.equal(filterSchedules(rows, { ...filters, product: ['X'], test: ['T2'] }).length, 0);
});
const person = (id, name, extra = {}) => ({ id, name, active: true, assay_qualifications: [{ assay_name: 'T1', status: 'Qualified' }], ...extra });
const people = [person('b', 'Bob'), person('a', 'Alice'), person('c', 'Cara'), person('d', 'Dan', { time_off: [{ type: 'Vacation', start_date: '2026-10-03', end_date: '2026-10-05' }] }), person('e', 'Erin', { active: false }), person('f', 'Fran', { assay_qualifications: [] })];
const history = [{ assignee_id: 'a', test_name: 'T1', start_time: '2026-08-01' }, { assignee_id: 'c', test_name: 'T1', start_time: '2026-09-01' }, { assignee_id: 'b', test_name: 'T1', start_time: '2026-10-01', status: 'Deleted' }];
test('Displayed ranking equals automatic choice, with new analysts ahead of previous assignments', () => {
  const ranked = rankedAnalystsForAssay(people, history, ' t1 ', '2026-10-01', 3);
  assert.deepEqual(ranked.map(item => item.person.id), ['b', 'a', 'c']);
  assert.equal(ranked[1].lastAssignment, '2026-08-01');
  assert.equal(rollingAssigneeForAssay(people, history, 'T1', '2026-10-01', 3), ranked[0].person.id);
});
test('PTO on final execution day excludes analyst; outside window remains eligible', () => {
  assert.equal(rankedAnalystsForAssay([people[3]], [], 'T1', '2026-10-01', 3).length, 0);
  assert.equal(rankedAnalystsForAssay([people[3]], [], 'T1', '2026-10-01', 2).length, 1);
});
test('Ties sort alphabetically and unavailable pool yields no choice', () => {
  assert.deepEqual(rankedAnalystsForAssay(people.slice(0, 3), [], 'T1').map(item => item.person.id), ['a', 'b', 'c']);
  assert.equal(rollingAssigneeForAssay(people.slice(4), [], 'T1'), '');
});
