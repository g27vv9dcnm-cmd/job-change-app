// 純粋なデータ処理（ブラウザ・Node 両方で動く）。保存処理は store.js が担当する。

export const PRESET_SITES = [
  'リクナビNEXT',
  'doda',
  'ビズリーチ',
  'マイナビ転職',
  'en転職',
  'Green',
  '公式サイト',
];

export const NAME_MAX = 100;
/** 自分で作る項目（逆質問・志望動機など）の項目名の長さの上限 */
export const FIELD_TITLE_MAX = 50;
export const BACKUP_FORMAT = 'job-change-app-backup';
export const BACKUP_VERSION = 2;

/** 面接・セミナー記録の種類 */
export const SESSION_TYPES = ['面接', 'セミナー・説明会', 'カジュアル面談', 'その他'];
export const TITLE_MAX = 100;

/** 入力値を整形する（前後の空白除去、サイトの重複除去） */
export function normalizeInput(input) {
  const sites = Array.isArray(input.sites) ? input.sites : [];
  const seen = new Set();
  const cleanSites = [];
  for (const s of sites) {
    const v = String(s ?? '').trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      cleanSites.push(v);
    }
  }
  return {
    name: String(input.name ?? '').trim(),
    sites: cleanSites,
    url: String(input.url ?? '').trim(),
    memo: String(input.memo ?? '').replace(/\s+$/, ''),
    fields: normalizeFields(input.fields),
  };
}

/** 自分で作る項目を整形する（項目名も内容も空の項目は捨てる。id が無ければ振る） */
export function normalizeFields(fields) {
  if (!Array.isArray(fields)) return [];
  const seen = new Set();
  const out = [];
  for (const f of fields) {
    const title = String(f?.title ?? '').trim();
    const body = String(f?.body ?? '').replace(/\s+$/, '').replace(/^\s*\n/, '');
    if (!title && !body.trim()) continue;
    const id = typeof f?.id === 'string' && f.id && !seen.has(f.id) ? f.id : newId();
    seen.add(id);
    out.push({ id, title, body });
  }
  return out;
}

/** 会社の項目一覧（古いデータには fields が無いので空にする） */
export const fieldsOf = (c) => (Array.isArray(c?.fields) ? c.fields : []);

/** 入力チェック。問題があれば { 項目名: メッセージ } を返す。問題なしなら空オブジェクト */
export function validate(input) {
  const errors = {};
  if (!input.name) {
    errors.name = '会社名を入力してください';
  } else if (input.name.length > NAME_MAX) {
    errors.name = `会社名は${NAME_MAX}文字以内にしてください`;
  }
  if (input.url && !isHttpUrl(input.url)) {
    errors.url = 'http:// または https:// で始まるURLを入力してください';
  }
  // 項目のエラーは `field:{項目のid}` に入れる（画面の行と対応させるため）
  for (const f of input.fields ?? []) {
    if (!f.title) errors[`field:${f.id}`] = '項目名を入力してください';
    else if (f.title.length > FIELD_TITLE_MAX) errors[`field:${f.id}`] = `項目名は${FIELD_TITLE_MAX}文字以内にしてください`;
  }
  return errors;
}

export function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

/** 新規作成。入力は normalizeInput 済みで validate を通っている前提 */
export function createCompany(input, now = new Date()) {
  const t = now.toISOString();
  return { id: newId(), ...input, createdAt: t, updatedAt: t };
}

export function updateCompany(existing, input, now = new Date()) {
  return { ...existing, ...input, id: existing.id, createdAt: existing.createdAt, updatedAt: now.toISOString() };
}

/** 検索語（会社名・メモ・自分で作った項目）とサイトで絞り込み、更新が新しい順に並べる */
export function filterCompanies(companies, { query = '', site = '' } = {}) {
  const q = query.trim().toLowerCase();
  const hit = (c) =>
    [c.name, c.memo, ...fieldsOf(c).flatMap((f) => [f.title, f.body])].some((t) => String(t ?? '').toLowerCase().includes(q));
  return companies
    .filter((c) => !site || c.sites.includes(site))
    .filter((c) => !q || hit(c))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

/** 登録済みの会社で使われているサイト一覧（プリセット順 → それ以外は名前順） */
export function usedSites(companies) {
  const used = new Set(companies.flatMap((c) => c.sites));
  const preset = PRESET_SITES.filter((s) => used.has(s));
  const others = [...used].filter((s) => !PRESET_SITES.includes(s)).sort((a, b) => a.localeCompare(b, 'ja'));
  return [...preset, ...others];
}

/** これまでに使った項目名（よく使う順 → 同数なら名前順）。他の会社で追加するときの候補にする */
export function usedFieldTitles(companies) {
  const count = new Map();
  for (const c of companies) {
    for (const t of new Set(fieldsOf(c).map((f) => f.title).filter(Boolean))) count.set(t, (count.get(t) ?? 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')).map(([t]) => t);
}

/* ---------- 面接・セミナー記録 ---------- */

function normalizePairs(pairs) {
  if (!Array.isArray(pairs)) return [];
  return pairs
    .map((p) => ({
      q: String(p?.q ?? '').trim(),
      a: String(p?.a ?? '').replace(/\s+$/, '').replace(/^\s*\n/, ''),
    }))
    .filter((p) => p.q || p.a.trim());
}

/** 記録の入力値を整形する（空の質問行は捨てる） */
export function normalizeSessionInput(input) {
  return {
    type: String(input.type ?? '').trim(),
    date: String(input.date ?? '').trim(),
    title: String(input.title ?? '').trim(),
    asked: normalizePairs(input.asked),
    myQuestions: normalizePairs(input.myQuestions),
    memo: String(input.memo ?? '').replace(/\s+$/, ''),
  };
}

export function isValidDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

export function validateSession(input) {
  const errors = {};
  if (!SESSION_TYPES.includes(input.type)) errors.type = '種類を選んでください';
  if (input.date && !isValidDate(input.date)) errors.date = '日付が正しくありません';
  if (input.title.length > TITLE_MAX) errors.title = `名前は${TITLE_MAX}文字以内にしてください`;
  return errors;
}

export function createSession(companyId, input, now = new Date()) {
  const t = now.toISOString();
  return { id: newId(), companyId, ...input, createdAt: t, updatedAt: t };
}

export function updateSession(existing, input, now = new Date()) {
  return {
    ...existing,
    ...input,
    id: existing.id,
    companyId: existing.companyId,
    createdAt: existing.createdAt,
    updatedAt: now.toISOString(),
  };
}

/** 記録の表示名（名前がなければ種類） */
export function sessionLabel(s) {
  return s.title || s.type;
}

/** 日付の新しい順（日付なしは最後）、同じ日付なら作成が新しい順 */
export function sortSessions(sessions) {
  return [...sessions].sort((a, b) => {
    if (a.date !== b.date) {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date < b.date ? 1 : -1;
    }
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  });
}

export function sessionsOf(sessions, companyId) {
  return sortSessions(sessions.filter((s) => s.companyId === companyId));
}

/** 'YYYY-MM-DD' を「2026/11/03（火）」の形にする */
export function formatDate(value) {
  if (!isValidDate(value)) return '';
  const [y, m, d] = value.split('-').map(Number);
  const w = '日月火水木金土'[new Date(y, m - 1, d).getDay()];
  return `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}（${w}）`;
}

export function todayString(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/* ---------- バックアップ ---------- */

export function toBackup(companies, sessions = [], now = new Date()) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    companies,
    sessions,
  };
}

export function backupFileName(now = new Date()) {
  return `job-change-backup-${todayString(now)}.json`;
}

function timestamps(raw) {
  const now = new Date().toISOString();
  return {
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
  };
}

function hasId(raw) {
  return raw && typeof raw === 'object' && typeof raw.id === 'string' && raw.id && !raw.id.includes('/');
}

/**
 * バックアップ文字列を読み取る。壊れていれば例外を投げる（既存データには触らない）。
 * 古い形式（会社だけ）にも対応する。戻り値は { companies, sessions }。
 */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('ファイルの形式が正しくありません');
  }
  if (!data || data.format !== BACKUP_FORMAT || !Array.isArray(data.companies)) {
    throw new Error('このアプリのバックアップファイルではありません');
  }
  if (data.sessions !== undefined && !Array.isArray(data.sessions)) {
    throw new Error('面接・セミナー記録のデータが壊れています');
  }
  const companies = data.companies.map((raw, i) => {
    if (!hasId(raw)) throw new Error(`会社の${i + 1}件目のデータが壊れています`);
    const input = normalizeInput(raw);
    if (Object.keys(validate(input)).length) throw new Error(`会社の${i + 1}件目のデータが壊れています`);
    return { id: raw.id, ...input, ...timestamps(raw) };
  });
  const companyIds = new Set(companies.map((c) => c.id));
  const sessions = (data.sessions ?? []).map((raw, i) => {
    if (!hasId(raw) || !companyIds.has(raw.companyId)) {
      throw new Error(`面接・セミナー記録の${i + 1}件目のデータが壊れています`);
    }
    const input = normalizeSessionInput(raw);
    if (Object.keys(validateSession(input)).length) {
      throw new Error(`面接・セミナー記録の${i + 1}件目のデータが壊れています`);
    }
    return { id: raw.id, companyId: raw.companyId, ...input, ...timestamps(raw) };
  });
  return { companies, sessions };
}

/** 読み込み結果の件数を数える（同じIDは上書き、それ以外は追加） */
export function countImport(existing, incoming) {
  const ids = new Set(existing.map((c) => c.id));
  let updated = 0;
  let added = 0;
  for (const c of incoming) {
    if (ids.has(c.id)) updated++;
    else added++;
  }
  return { added, updated };
}

/**
 * incoming のうち、existing に無いもの・existing より新しいもの（updatedAt が後）だけを返す。
 * 端末に残った古いデータでクラウドの新しいデータを上書きしないために使う。
 */
export function pickNewer(existing, incoming) {
  const byId = new Map(existing.map((x) => [x.id, x]));
  return incoming.filter((x) => {
    const cur = byId.get(x.id);
    return !cur || String(x.updatedAt ?? '') > String(cur.updatedAt ?? '');
  });
}
