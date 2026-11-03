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
export const BACKUP_FORMAT = 'job-change-app-backup';
export const BACKUP_VERSION = 1;

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
  };
}

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

/** 検索語（会社名・メモ）とサイトで絞り込み、更新が新しい順に並べる */
export function filterCompanies(companies, { query = '', site = '' } = {}) {
  const q = query.trim().toLowerCase();
  return companies
    .filter((c) => !site || c.sites.includes(site))
    .filter((c) => !q || c.name.toLowerCase().includes(q) || c.memo.toLowerCase().includes(q))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

/** 登録済みの会社で使われているサイト一覧（プリセット順 → それ以外は名前順） */
export function usedSites(companies) {
  const used = new Set(companies.flatMap((c) => c.sites));
  const preset = PRESET_SITES.filter((s) => used.has(s));
  const others = [...used].filter((s) => !PRESET_SITES.includes(s)).sort((a, b) => a.localeCompare(b, 'ja'));
  return [...preset, ...others];
}

export function toBackup(companies, now = new Date()) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    companies,
  };
}

export function backupFileName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `job-change-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/**
 * バックアップ文字列を読み取る。壊れていれば例外を投げる（既存データには触らない）。
 * 戻り値は検証済みの会社配列。
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
  return data.companies.map((raw, i) => {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) {
      throw new Error(`${i + 1}件目のデータが壊れています`);
    }
    const input = normalizeInput(raw);
    const errors = validate(input);
    if (Object.keys(errors).length) {
      throw new Error(`${i + 1}件目のデータが壊れています`);
    }
    const now = new Date().toISOString();
    return {
      id: raw.id,
      ...input,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
    };
  });
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
