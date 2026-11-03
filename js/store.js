// データの保存・同期を担当する（Firebase Authentication + Cloud Firestore）。
//
// データの置き場所: users/{ログインした人のID}/companies/{会社ID}
//                   users/{ログインした人のID}/sessions/{記録ID}（companyId で会社とひもづけ）
//
// Firestore の端末内キャッシュを使うので、圏外でも読み書きでき、つながると自動で同期される。
// 書き込みはサーバーの返事を待たずに画面へ反映し、失敗したときだけ onError で知らせる。
import * as fb from '../vendor/firebase.js';
import { firebaseConfig, useEmulator } from './firebase-config.js';
import {
  normalizeInput,
  validate,
  createCompany,
  updateCompany,
  normalizeSessionInput,
  validateSession,
  createSession,
  updateSession,
  toBackup,
  parseBackup,
  countImport,
} from './model.js';

export class ValidationError extends Error {
  constructor(errors) {
    super('入力内容を確認してください');
    this.errors = errors;
  }
}

let auth = null;
let db = null;
let uid = null;
let unsubs = [];
let companies = new Map();
let sessions = new Map();
const status = { companiesPending: false, sessionsPending: false, fromCache: true };

const dataListeners = new Set();
const statusListeners = new Set();
const errorListeners = new Set();

export const onData = (fn) => (dataListeners.add(fn), () => dataListeners.delete(fn));
export const onStatus = (fn) => (statusListeners.add(fn), () => statusListeners.delete(fn));
export const onError = (fn) => (errorListeners.add(fn), () => errorListeners.delete(fn));

const emitData = () => dataListeners.forEach((fn) => fn());
const emitStatus = () => statusListeners.forEach((fn) => fn(syncStatus()));
const emitError = (err) => {
  console.error(err);
  errorListeners.forEach((fn) => fn(err));
};

export function isConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}

/* ---------- 初期化とログイン ---------- */

export function init() {
  if (auth) return;
  const app = fb.initializeApp(firebaseConfig);
  auth = fb.initializeAuth(app, {
    persistence: [fb.indexedDBLocalPersistence, fb.browserLocalPersistence, fb.inMemoryPersistence],
  });
  let localCache;
  try {
    localCache = fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() });
  } catch {
    localCache = fb.memoryLocalCache();
  }
  db = fb.initializeFirestore(app, { localCache });
  if (useEmulator) {
    fb.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    fb.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
}

/** ログイン状態が変わるたびに呼ばれる（起動直後にも1回呼ばれる） */
export function onAuth(fn) {
  return fb.onAuthStateChanged(auth, fn);
}

export function currentEmail() {
  return auth?.currentUser?.email ?? '';
}

export function signIn(email, password) {
  return fb.signInWithEmailAndPassword(auth, email.trim(), password);
}

export function resetPassword(email) {
  return fb.sendPasswordResetEmail(auth, email.trim());
}

export async function signOut() {
  stopSync();
  await fb.signOut(auth);
}

/** ログインエラーを日本語にする */
export function authErrorMessage(err) {
  switch (err?.code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-login-credentials':
      return 'メールアドレスかパスワードが違います';
    case 'auth/invalid-email':
    case 'auth/missing-email':
      return 'メールアドレスの形が正しくありません';
    case 'auth/missing-password':
      return 'パスワードを入力してください';
    case 'auth/too-many-requests':
      return '何度も失敗したため一時的に止められています。しばらくしてから試してください';
    case 'auth/network-request-failed':
      return 'ネットにつながっていません。つながる場所で試してください';
    case 'auth/user-disabled':
      return 'このアカウントは無効になっています';
    default:
      return `ログインできませんでした（${err?.code || err?.message || '不明なエラー'}）`;
  }
}

/** 保存エラーを日本語にする */
export function saveErrorMessage(err) {
  if (err?.code === 'permission-denied') {
    return '保存できませんでした。Firebase のルール設定を確認してください';
  }
  if (err?.code === 'resource-exhausted') {
    return '保存できませんでした。Firebase の無料枠の上限に達した可能性があります';
  }
  return `保存できませんでした（${err?.code || err?.message || '不明なエラー'}）`;
}

/* ---------- 同期 ---------- */

const userCol = (name) => fb.collection(db, 'users', uid, name);
const userDoc = (name, id) => fb.doc(db, 'users', uid, name, id);

/** ログインした人のデータの購読を始める。両方の最初のデータが届いたら resolve */
export function startSync(user) {
  stopSync();
  uid = user.uid;
  return new Promise((resolve) => {
    const firstLoaded = { companies: false, sessions: false };
    const listen = (name, setMap, pendingKey) =>
      fb.onSnapshot(
        userCol(name),
        { includeMetadataChanges: true },
        (snap) => {
          const changed = !firstLoaded[name] || snap.docChanges().length > 0;
          if (changed) setMap(new Map(snap.docs.map((d) => [d.id, d.data()])));
          status[pendingKey] = snap.metadata.hasPendingWrites;
          status.fromCache = snap.metadata.fromCache;
          if (!firstLoaded[name]) {
            firstLoaded[name] = true;
            if (firstLoaded.companies && firstLoaded.sessions) resolve();
          }
          if (changed) emitData();
          emitStatus();
        },
        (err) => {
          emitError(err);
          if (!firstLoaded[name]) {
            firstLoaded[name] = true;
            if (firstLoaded.companies && firstLoaded.sessions) resolve();
          }
        },
      );
    unsubs = [
      listen('companies', (m) => (companies = m), 'companiesPending'),
      listen('sessions', (m) => (sessions = m), 'sessionsPending'),
    ];
  });
}

export function stopSync() {
  unsubs.forEach((u) => u());
  unsubs = [];
  uid = null;
  companies = new Map();
  sessions = new Map();
}

/** 同期の状態: 'pending'（未送信の変更あり）| 'offline'（サーバー未確認）| 'synced' */
export function syncStatus() {
  if (status.companiesPending || status.sessionsPending) return 'pending';
  if (status.fromCache) return 'offline';
  return 'synced';
}

function fire(promise) {
  promise.catch(emitError);
}

/* ---------- 会社 ---------- */

export const getAll = () => [...companies.values()];
export const get = (id) => companies.get(id) ?? null;

export function add(rawInput) {
  const input = normalizeInput(rawInput);
  const errors = validate(input);
  if (Object.keys(errors).length) throw new ValidationError(errors);
  const company = createCompany(input);
  companies.set(company.id, company);
  fire(fb.setDoc(userDoc('companies', company.id), company));
  return company;
}

export function update(id, rawInput) {
  const input = normalizeInput(rawInput);
  const errors = validate(input);
  if (Object.keys(errors).length) throw new ValidationError(errors);
  const existing = get(id);
  if (!existing) throw new Error('この会社は見つかりませんでした');
  const company = updateCompany(existing, input);
  companies.set(company.id, company);
  fire(fb.setDoc(userDoc('companies', company.id), company));
  return company;
}

/** 会社と、その会社の記録をまとめて削除する */
export function remove(id) {
  const batch = fb.writeBatch(db);
  batch.delete(userDoc('companies', id));
  for (const s of sessionsFor(id)) {
    batch.delete(userDoc('sessions', s.id));
    sessions.delete(s.id);
  }
  companies.delete(id);
  fire(batch.commit());
}

/* ---------- 面接・セミナー記録 ---------- */

export const getAllSessions = () => [...sessions.values()];
export const getSession = (id) => sessions.get(id) ?? null;
export const sessionsFor = (companyId) => getAllSessions().filter((s) => s.companyId === companyId);

export function addSession(companyId, rawInput) {
  if (!get(companyId)) throw new Error('この会社は見つかりませんでした');
  const input = normalizeSessionInput(rawInput);
  const errors = validateSession(input);
  if (Object.keys(errors).length) throw new ValidationError(errors);
  const s = createSession(companyId, input);
  sessions.set(s.id, s);
  fire(fb.setDoc(userDoc('sessions', s.id), s));
  return s;
}

export function updateSessionById(id, rawInput) {
  const input = normalizeSessionInput(rawInput);
  const errors = validateSession(input);
  if (Object.keys(errors).length) throw new ValidationError(errors);
  const existing = getSession(id);
  if (!existing) throw new Error('この記録は見つかりませんでした');
  const s = updateSession(existing, input);
  sessions.set(s.id, s);
  fire(fb.setDoc(userDoc('sessions', s.id), s));
  return s;
}

export function removeSession(id) {
  sessions.delete(id);
  fire(fb.deleteDoc(userDoc('sessions', id)));
}

/* ---------- バックアップ・移行 ---------- */

export function exportBackup() {
  return JSON.stringify(toBackup(getAll(), getAllSessions()), null, 2);
}

/** 読み込む前に件数を数える（壊れたファイルなら例外） */
export function previewImport(text) {
  const data = parseBackup(text);
  return {
    data,
    companies: countImport(getAll(), data.companies),
    sessions: countImport(getAllSessions(), data.sessions),
  };
}

/** まとめて書き込む（同じIDは上書き、それ以外は追加）。1回の書き込みは500件までなので分ける */
export function importData({ companies: cs, sessions: ss }) {
  const writes = [
    ...cs.map((c) => ['companies', c]),
    ...ss.map((s) => ['sessions', s]),
  ];
  for (let i = 0; i < writes.length; i += 400) {
    const batch = fb.writeBatch(db);
    for (const [name, item] of writes.slice(i, i + 400)) {
      batch.set(userDoc(name, item.id), item);
      (name === 'companies' ? companies : sessions).set(item.id, item);
    }
    fire(batch.commit());
  }
}
