// 端末内（IndexedDB）への保存・読み出しだけを担当する。
import {
  normalizeInput,
  validate,
  createCompany,
  updateCompany,
  toBackup,
  parseBackup,
  countImport,
} from './model.js';

const DB_NAME = 'job-change-app';
const DB_VERSION = 1;
const STORE = 'companies';

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        let result;
        Promise.resolve(fn(store)).then((r) => (result = r));
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('保存に失敗しました'));
      }),
  );
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class ValidationError extends Error {
  constructor(errors) {
    super('入力内容を確認してください');
    this.errors = errors;
  }
}

export function getAll() {
  return tx('readonly', (s) => reqToPromise(s.getAll()));
}

export function get(id) {
  return tx('readonly', (s) => reqToPromise(s.get(id)));
}

/** 新規登録。入力に問題があれば ValidationError */
export async function add(rawInput) {
  const input = normalizeInput(rawInput);
  const errors = validate(input);
  if (Object.keys(errors).length) throw new ValidationError(errors);
  const company = createCompany(input);
  await tx('readwrite', (s) => s.put(company));
  return company;
}

export async function update(id, rawInput) {
  const input = normalizeInput(rawInput);
  const errors = validate(input);
  if (Object.keys(errors).length) throw new ValidationError(errors);
  const existing = await get(id);
  if (!existing) throw new Error('この会社は見つかりませんでした');
  const company = updateCompany(existing, input);
  await tx('readwrite', (s) => s.put(company));
  return company;
}

export function remove(id) {
  return tx('readwrite', (s) => s.delete(id));
}

export async function exportBackup() {
  return JSON.stringify(toBackup(await getAll()), null, 2);
}

/** バックアップを読み込む。壊れたファイルなら例外を投げ、既存データは変更しない */
export async function importBackup(text) {
  const incoming = parseBackup(text);
  const existing = await getAll();
  const counts = countImport(existing, incoming);
  await tx('readwrite', (s) => {
    for (const c of incoming) s.put(c);
  });
  return counts;
}
