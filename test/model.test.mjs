import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeInput,
  validate,
  createCompany,
  updateCompany,
  filterCompanies,
  usedSites,
  toBackup,
  parseBackup,
  countImport,
  backupFileName,
} from '../js/model.js';

const mk = (over = {}) => ({
  id: over.id ?? Math.random().toString(36),
  name: 'A社',
  sites: [],
  url: '',
  memo: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

test('normalizeInput trims and dedupes sites', () => {
  const r = normalizeInput({ name: '  株式会社X ', sites: ['doda', ' doda ', '', 'Green'], url: ' https://x.jp ', memo: 'メモ\n\n' });
  assert.deepEqual(r, { name: '株式会社X', sites: ['doda', 'Green'], url: 'https://x.jp', memo: 'メモ' });
});

test('validate requires name', () => {
  assert.equal(validate(normalizeInput({ name: '   ' })).name, '会社名を入力してください');
  assert.deepEqual(validate(normalizeInput({ name: 'X' })), {});
});

test('validate name length', () => {
  assert.ok(validate(normalizeInput({ name: 'あ'.repeat(101) })).name);
  assert.deepEqual(validate(normalizeInput({ name: 'あ'.repeat(100) })), {});
});

test('validate url', () => {
  assert.ok(validate(normalizeInput({ name: 'X', url: 'example.com' })).url);
  assert.ok(validate(normalizeInput({ name: 'X', url: 'javascript:alert(1)' })).url);
  assert.deepEqual(validate(normalizeInput({ name: 'X', url: 'https://example.com/job/1' })), {});
  assert.deepEqual(validate(normalizeInput({ name: 'X', url: '' })), {});
});

test('create and update keep id/createdAt', () => {
  const c = createCompany(normalizeInput({ name: 'X' }), new Date('2026-01-01T00:00:00Z'));
  assert.ok(c.id);
  assert.equal(c.createdAt, '2026-01-01T00:00:00.000Z');
  const u = updateCompany(c, normalizeInput({ name: 'Y', sites: ['doda'] }), new Date('2026-02-01T00:00:00Z'));
  assert.equal(u.id, c.id);
  assert.equal(u.name, 'Y');
  assert.equal(u.createdAt, c.createdAt);
  assert.equal(u.updatedAt, '2026-02-01T00:00:00.000Z');
});

test('filterCompanies by query, site and sorted newest first', () => {
  const list = [
    mk({ id: '1', name: 'アルファ', sites: ['doda'], updatedAt: '2026-01-01T00:00:00Z' }),
    mk({ id: '2', name: 'ベータ', sites: ['Green'], memo: 'リモート可', updatedAt: '2026-03-01T00:00:00Z' }),
    mk({ id: '3', name: 'Gamma', sites: ['doda', 'Green'], updatedAt: '2026-02-01T00:00:00Z' }),
  ];
  assert.deepEqual(filterCompanies(list).map((c) => c.id), ['2', '3', '1']);
  assert.deepEqual(filterCompanies(list, { site: 'doda' }).map((c) => c.id), ['3', '1']);
  assert.deepEqual(filterCompanies(list, { query: 'リモート' }).map((c) => c.id), ['2']);
  assert.deepEqual(filterCompanies(list, { query: 'gam' }).map((c) => c.id), ['3']);
  assert.deepEqual(filterCompanies(list, { query: 'アル', site: 'Green' }), []);
});

test('usedSites orders presets first', () => {
  const list = [mk({ sites: ['自社エージェント', 'Green'] }), mk({ sites: ['doda'] })];
  assert.deepEqual(usedSites(list), ['doda', 'Green', '自社エージェント']);
});

test('backup round trip', () => {
  const list = [mk({ id: 'a', name: 'X', sites: ['doda'], url: 'https://x.jp', memo: 'm' })];
  const text = JSON.stringify(toBackup(list));
  assert.deepEqual(parseBackup(text), list);
});

test('parseBackup rejects broken files', () => {
  assert.throws(() => parseBackup('not json'), /形式/);
  assert.throws(() => parseBackup('{"foo":1}'), /バックアップファイルではありません/);
  assert.throws(() => parseBackup(JSON.stringify(toBackup([{ id: 'a', name: '' }]))), /1件目/);
  assert.throws(() => parseBackup(JSON.stringify(toBackup([{ name: 'X' }]))), /1件目/);
});

test('countImport', () => {
  assert.deepEqual(countImport([mk({ id: 'a' })], [mk({ id: 'a' }), mk({ id: 'b' })]), { added: 1, updated: 1 });
});

test('backupFileName', () => {
  assert.equal(backupFileName(new Date(2026, 10, 3)), 'job-change-backup-2026-11-03.json');
});
