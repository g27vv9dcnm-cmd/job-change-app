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
  normalizeSessionInput,
  validateSession,
  createSession,
  updateSession,
  sortSessions,
  sessionsOf,
  sessionLabel,
  formatDate,
  isValidDate,
  todayString,
  BACKUP_FORMAT,
  pickNewer,
  fieldsOf,
  usedFieldTitles,
  normalizeMarks,
  cleanRich,
  toggleMark,
  clearMarks,
  isMarked,
  markSegments,
  createTrashEntry,
  trashDaysLeft,
  trashLabel,
  sortTrash,
  removedFields,
  insertField,
} from "../js/model.js";

const mk = (over = {}) => ({
  id: over.id ?? Math.random().toString(36),
  name: 'A社',
  sites: [],
  url: '',
  memo: '',
  memoMarks: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

test('normalizeInput trims and dedupes sites', () => {
  const r = normalizeInput({ name: '  株式会社X ', sites: ['doda', ' doda ', '', 'Green'], url: ' https://x.jp ', memo: 'メモ\n\n' });
  assert.deepEqual(r, { name: '株式会社X', sites: ['doda', 'Green'], url: 'https://x.jp', memo: 'メモ', memoMarks: [], fields: [] });
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

const mkSession = (over = {}) => ({
  id: over.id ?? Math.random().toString(36),
  companyId: 'a',
  type: '面接',
  date: '2026-11-01',
  title: '一次面接',
  asked: [{ q: '志望動機は？', a: '御社の〜', aMarks: [] }],
  myQuestions: [{ q: '配属は？', a: '開発部', aMarks: [] }],
  memo: '',
  memoMarks: [],
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...over,
});

test('backup round trip with sessions', () => {
  const list = [mk({ id: 'a', name: 'X', sites: ['doda'], url: 'https://x.jp', memo: 'm', fields: [{ id: 'f', title: '逆質問', body: 'b', bodyMarks: [{ s: 0, e: 1, t: 'hl' }] }] })];
  const sessions = [mkSession({ id: 's1' })];
  const text = JSON.stringify(toBackup(list, sessions));
  assert.deepEqual(parseBackup(text), { companies: list, sessions });
});

test('parseBackup reads old version-1 files (companies only)', () => {
  const list = [mk({ id: 'a' })];
  const v1 = JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: 'x', companies: list });
  assert.deepEqual(parseBackup(v1), { companies: list.map((c) => ({ ...c, fields: [] })), sessions: [] });
});

test('parseBackup rejects broken files', () => {
  assert.throws(() => parseBackup('not json'), /形式/);
  assert.throws(() => parseBackup('{"foo":1}'), /バックアップファイルではありません/);
  assert.throws(() => parseBackup(JSON.stringify(toBackup([{ id: 'a', name: '' }]))), /会社の1件目/);
  assert.throws(() => parseBackup(JSON.stringify(toBackup([{ name: 'X' }]))), /会社の1件目/);
  assert.throws(() => parseBackup(JSON.stringify(toBackup([{ id: 'a/b', name: 'X' }]))), /会社の1件目/);
  const companies = [mk({ id: 'a' })];
  assert.throws(() => parseBackup(JSON.stringify(toBackup(companies, [mkSession({ companyId: 'zzz' })]))), /記録の1件目/);
  assert.throws(() => parseBackup(JSON.stringify(toBackup(companies, [mkSession({ type: '謎' })]))), /記録の1件目/);
  assert.throws(() => parseBackup(JSON.stringify({ ...toBackup(companies), sessions: 'x' })), /記録のデータ/);
});

test('normalizeSessionInput drops empty question rows and trims', () => {
  const r = normalizeSessionInput({
    type: '面接',
    date: ' 2026-11-03 ',
    title: ' 一次面接 ',
    asked: [{ q: ' 志望動機 ', a: '答え\n' }, { q: '', a: '  ' }, { q: '', a: '答えだけ' }],
    myQuestions: [{ q: '', a: '' }],
    memo: 'メモ\n\n',
  });
  assert.deepEqual(r, {
    type: '面接',
    date: '2026-11-03',
    title: '一次面接',
    asked: [{ q: '志望動機', a: '答え', aMarks: [] }, { q: '', a: '答えだけ', aMarks: [] }],
    myQuestions: [],
    memo: 'メモ',
    memoMarks: [],
  });
});

test('validateSession', () => {
  assert.deepEqual(validateSession(normalizeSessionInput({ type: '面接' })), {});
  assert.ok(validateSession(normalizeSessionInput({ type: '' })).type);
  assert.ok(validateSession(normalizeSessionInput({ type: '面接', date: '2026-02-30' })).date);
  assert.ok(validateSession(normalizeSessionInput({ type: '面接', date: '2026/11/03' })).date);
  assert.ok(validateSession(normalizeSessionInput({ type: '面接', title: 'あ'.repeat(101) })).title);
});

test('isValidDate and formatDate', () => {
  assert.equal(isValidDate('2026-11-03'), true);
  assert.equal(isValidDate('2026-13-01'), false);
  assert.equal(formatDate('2026-11-03'), '2026/11/03（火）');
  assert.equal(formatDate(''), '');
  assert.equal(todayString(new Date(2026, 0, 5)), '2026-01-05');
});

test('create/update session keeps ids', () => {
  const s = createSession('c1', normalizeSessionInput({ type: '面接' }), new Date('2026-01-01T00:00:00Z'));
  assert.equal(s.companyId, 'c1');
  const u = updateSession(s, normalizeSessionInput({ type: 'その他', title: 'X' }), new Date('2026-02-01T00:00:00Z'));
  assert.equal(u.id, s.id);
  assert.equal(u.companyId, 'c1');
  assert.equal(u.createdAt, s.createdAt);
  assert.equal(u.type, 'その他');
  assert.equal(sessionLabel(u), 'X');
  assert.equal(sessionLabel(s), '面接');
});

test('sortSessions / sessionsOf: newest date first, undated last', () => {
  const list = [
    mkSession({ id: '1', date: '2026-10-01' }),
    mkSession({ id: '2', date: '' }),
    mkSession({ id: '3', date: '2026-11-01', createdAt: '2026-11-01T00:00:00Z' }),
    mkSession({ id: '4', date: '2026-11-01', createdAt: '2026-11-02T00:00:00Z' }),
    mkSession({ id: '5', companyId: 'b' }),
  ];
  assert.deepEqual(sortSessions(list.slice(0, 4)).map((s) => s.id), ['4', '3', '1', '2']);
  assert.deepEqual(sessionsOf(list, 'b').map((s) => s.id), ['5']);
});

test('countImport', () => {
  assert.deepEqual(countImport([mk({ id: 'a' })], [mk({ id: 'a' }), mk({ id: 'b' })]), { added: 1, updated: 1 });
});

test('backupFileName', () => {
  assert.equal(backupFileName(new Date(2026, 10, 3)), 'job-change-backup-2026-11-03.json');
});

test('pickNewer keeps only missing or newer items', () => {
  const existing = [
    { id: 'a', updatedAt: '2026-11-02T00:00:00.000Z' },
    { id: 'b', updatedAt: '2026-11-02T00:00:00.000Z' },
  ];
  const incoming = [
    { id: 'a', updatedAt: '2026-11-01T00:00:00.000Z' }, // クラウドの方が新しい → 移さない
    { id: 'b', updatedAt: '2026-11-03T00:00:00.000Z' }, // 端末の方が新しい → 移す
    { id: 'c', updatedAt: '2026-10-01T00:00:00.000Z' }, // クラウドに無い → 移す
    { id: 'a2', updatedAt: '2026-11-02T00:00:00.000Z' },
  ];
  assert.deepEqual(pickNewer(existing, incoming).map((x) => x.id), ['b', 'c', 'a2']);
  assert.deepEqual(pickNewer(existing, [{ ...existing[0] }]), []);
  assert.equal(pickNewer([], incoming).length, 4);
});

test('custom fields: normalize drops empty, keeps order and ids', () => {
  const input = normalizeInput({
    name: 'A',
    fields: [
      { id: 'f1', title: ' 逆質問 ', body: '残業は？\n\n' },
      { id: 'f2', title: '', body: '   ' },
      { title: '志望動機', body: '' },
      { id: 'f1', title: '重複ID', body: 'x' },
    ],
  });
  assert.deepEqual(input.fields.map((f) => f.title), ['逆質問', '志望動機', '重複ID']);
  assert.equal(input.fields[0].id, 'f1');
  assert.equal(input.fields[0].body, '残業は？');
  assert.ok(input.fields[1].id && input.fields[2].id !== 'f1');
  assert.deepEqual(normalizeInput({ name: 'B' }).fields, []);
});

test('custom fields: validate requires a title when body is written', () => {
  const input = normalizeInput({ name: 'A', fields: [{ id: 'x', title: '', body: '内容だけ' }] });
  assert.equal(validate(input)['field:x'], '項目名を入力してください');
  const long = normalizeInput({ name: 'A', fields: [{ id: 'y', title: 'あ'.repeat(51), body: '' }] });
  assert.match(validate(long)['field:y'], /50文字/);
});

test('custom fields: search, used titles and backup round trip', () => {
  const a = { ...mk({ id: 'a', name: 'A社' }), fields: [{ id: '1', title: '逆質問', body: 'リモートワークの頻度', bodyMarks: [{ s: 0, e: 6, t: 'red' }] }] };
  const b = { ...mk({ id: 'b', name: 'B社' }), fields: [{ id: '2', title: '逆質問', body: '', bodyMarks: [] }, { id: '3', title: '自己PR', body: '', bodyMarks: [] }] };
  const old = mk({ id: 'c', name: 'C社' }); // fields が無い古いデータ
  assert.deepEqual(filterCompanies([a, b, old], { query: 'リモート' }).map((c) => c.id), ['a']);
  assert.deepEqual(usedFieldTitles([a, b, old]), ['逆質問', '自己PR']);
  assert.deepEqual(fieldsOf(old), []);
  const back = parseBackup(JSON.stringify(toBackup([a, old], [])));
  assert.deepEqual(back.companies[0].fields, a.fields);
  assert.deepEqual(back.companies[1].fields, []);
});

/* ---------- 色付け ---------- */

test('marks: normalize drops broken ranges, clips and merges', () => {
  const r = normalizeMarks(
    [
      { s: 0, e: 3, t: 'hl' },
      { s: 2, e: 6, t: 'hl' }, // 重なり → まとめる
      { s: 6, e: 8, t: 'hl' }, // 隣り合い → まとめる
      { s: 4, e: 99, t: 'red' }, // 範囲外 → 切る
      { s: 5, e: 5, t: 'bold' }, // 空 → 捨てる
      { s: 1, e: 2, t: 'blink' }, // 知らない種類 → 捨てる
      { s: 'a', e: 2, t: 'bold' }, // 壊れた値 → 捨てる
      null,
    ],
    10,
  );
  assert.deepEqual(r, [
    { s: 0, e: 8, t: 'hl' },
    { s: 4, e: 10, t: 'red' },
  ]);
  assert.deepEqual(normalizeMarks('x', 5), []);
});

test('marks: toggle adds, removes and splits', () => {
  const add = toggleMark([], 2, 5, 'hl', 10);
  assert.deepEqual(add, [{ s: 2, e: 5, t: 'hl' }]);
  assert.ok(isMarked(add, 3, 5, 'hl'));
  // 全部その色なら外す（真ん中だけ外すと2つに分かれる）
  assert.deepEqual(toggleMark(add, 3, 4, 'hl', 10), [
    { s: 2, e: 3, t: 'hl' },
    { s: 4, e: 5, t: 'hl' },
  ]);
  // 一部だけ色があるときは、全体に付ける
  assert.deepEqual(toggleMark(add, 4, 8, 'hl', 10), [{ s: 2, e: 8, t: 'hl' }]);
  // 種類ごとに別々に持つ
  const both = toggleMark(add, 0, 3, 'bold', 10);
  assert.deepEqual(both, [
    { s: 0, e: 3, t: 'bold' },
    { s: 2, e: 5, t: 'hl' },
  ]);
  assert.deepEqual(clearMarks(both, 1, 4, 10), [
    { s: 0, e: 1, t: 'bold' },
    { s: 4, e: 5, t: 'hl' },
  ]);
});

test('marks: segments for display', () => {
  assert.deepEqual(markSegments('あいうえお', [{ s: 1, e: 3, t: 'hl' }, { s: 2, e: 4, t: 'red' }]), [
    { text: 'あ', types: [] },
    { text: 'い', types: ['hl'] },
    { text: 'う', types: ['hl', 'red'] },
    { text: 'え', types: ['red'] },
    { text: 'お', types: [] },
  ]);
  assert.deepEqual(markSegments('', []), []);
});

test('marks: trimming text shifts and clips the ranges', () => {
  // 先頭の空行を消した分だけ前にずらし、末尾の空白で切る
  const r = cleanRich('\n\n年収とリモート  \n', [{ s: 2, e: 4, t: 'hl' }, { s: 5, e: 11, t: 'red' }], { dropLeadingBlankLines: true });
  assert.equal(r.text, '年収とリモート');
  assert.deepEqual(r.marks, [
    { s: 0, e: 2, t: 'hl' },
    { s: 3, e: 7, t: 'red' },
  ]);
  assert.deepEqual(cleanRich(undefined, undefined), { text: '', marks: [] });
});

test('marks: kept through normalize and backup, old data without marks still works', () => {
  const input = normalizeInput({ name: 'A', memo: '大事な話', memoMarks: [{ s: 0, e: 2, t: 'bold' }] });
  assert.deepEqual(input.memoMarks, [{ s: 0, e: 2, t: 'bold' }]);
  const old = normalizeInput({ name: 'B', memo: '古いメモ' });
  assert.deepEqual(old.memoMarks, []);
  const s = normalizeSessionInput({ type: '面接', asked: [{ q: 'Q', a: '答え', aMarks: [{ s: 0, e: 1, t: 'red' }] }], memo: 'm', memoMarks: [{ s: 0, e: 1, t: 'hl' }] });
  assert.deepEqual(s.asked[0].aMarks, [{ s: 0, e: 1, t: 'red' }]);
  assert.deepEqual(s.memoMarks, [{ s: 0, e: 1, t: 'hl' }]);
  const company = { ...mk({ id: 'a' }), memo: '大事な話', memoMarks: [{ s: 0, e: 2, t: 'bold' }] };
  const session = mkSession({ id: 's', asked: [{ q: 'Q', a: '答え', aMarks: [{ s: 0, e: 1, t: 'red' }] }] });
  const back = parseBackup(JSON.stringify(toBackup([company], [session])));
  assert.deepEqual(back.companies[0].memoMarks, company.memoMarks);
  assert.deepEqual(back.sessions[0].asked, session.asked);
});

/* ---------- ゴミ箱 ---------- */

test('trash: entry, days left and labels', () => {
  const now = new Date('2026-11-08T00:00:00.000Z');
  const e = createTrashEntry('company', { company: mk({ id: 'a', name: 'A社' }), sessions: [mkSession()] }, now);
  assert.equal(e.kind, 'company');
  assert.equal(e.deletedAt, now.toISOString());
  assert.ok(e.id);
  assert.equal(trashDaysLeft(e, now), 30);
  assert.equal(trashDaysLeft(e, new Date('2026-11-20T12:00:00.000Z')), 18);
  assert.equal(trashDaysLeft(e, new Date('2026-12-08T00:00:00.000Z')), 0);
  assert.equal(trashDaysLeft({ deletedAt: 'x' }, now), 0);
  assert.equal(trashLabel(e), '会社「A社」（面接・セミナー記録1件も含む）');
  assert.equal(trashLabel({ kind: 'session', companyName: 'A社', session: mkSession({ title: '' }) }), '「A社」の記録「面接」');
  assert.equal(trashLabel({ kind: 'field', companyName: 'A社', field: { title: '逆質問' } }), '「A社」の項目「逆質問」');
  const older = { ...e, id: 'o', deletedAt: '2026-11-01T00:00:00.000Z' };
  assert.deepEqual(sortTrash([older, e]).map((x) => x.id), [e.id, 'o']);
});

test('trash: removed fields keep their position and come back to it', () => {
  const f = (id) => ({ id, title: id, body: '', bodyMarks: [] });
  const before = [f('a'), f('b'), f('c')];
  const removed = removedFields(before, [f('a'), f('c')]);
  assert.deepEqual(removed, [{ field: f('b'), index: 1 }]);
  assert.deepEqual(insertField([f('a'), f('c')], f('b'), 1).map((x) => x.id), ['a', 'b', 'c']);
  // 位置が範囲外なら最後に、同じ id がすでにあれば何もしない
  assert.deepEqual(insertField([f('a')], f('b'), 9).map((x) => x.id), ['a', 'b']);
  assert.deepEqual(insertField([f('a'), f('b')], f('b'), 0).map((x) => x.id), ['a', 'b']);
  assert.deepEqual(removedFields(undefined, []), []);
});
