// データの保存・同期を担当する（Firebase Authentication + Cloud Firestore）。
//
// データの置き場所: users/{ログインした人のID}/companies/{会社ID}
//                   users/{ログインした人のID}/sessions/{記録ID}（companyId で会社とひもづけ）
//                   users/{ログインした人のID}/trash/{ゴミ箱のID}（消したものを30日間とっておく）
//
// Firestore の端末内キャッシュを使うので、圏外でも読み書きでき、つながると自動で同期される。
// 書き込みはサーバーの返事を待たずに画面へ反映し、失敗したときだけ onError で知らせる。
// まとめて書き込む importData だけは、保存の成否を Promise で返す。
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
  createTrashEntry,
  removedFields,
  insertField,
  fieldsOf,
  sortTrash,
  trashDaysLeft,
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
let trash = new Map();
const status = { companiesPending: false, sessionsPending: false, trashPending: false, fromCache: true };
let readError = null; // 読み込みが断られたときのエラー（購読はそこで止まる）

const dataListeners = new Set();
const statusListeners = new Set();
const errorListeners = new Set();

export const onData = (fn) => (dataListeners.add(fn), () => dataListeners.delete(fn));
export const onStatus = (fn) => (statusListeners.add(fn), () => statusListeners.delete(fn));
export const onError = (fn) => (errorListeners.add(fn), () => errorListeners.delete(fn));

const emitData = () => dataListeners.forEach((fn) => fn());
const emitStatus = () => statusListeners.forEach((fn) => fn(syncStatus()));
/** kind: 'write'（保存の失敗）| 'read'（読み込みの失敗） */
const emitError = (err, kind = 'write') => {
  console.error(err);
  errorListeners.forEach((fn) => fn(err, kind));
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

export function currentUid() {
  return uid;
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

/** 保存・読み込みエラーを日本語にする */
export function saveErrorMessage(err, kind = 'write') {
  const what = kind === 'read' ? 'データを読み込めませんでした' : '保存できませんでした';
  if (err?.code === 'permission-denied') {
    return `${what}。Firebase のルール設定を確認してください`;
  }
  if (kind === 'read') return `${what}（${err?.code || err?.message || '不明なエラー'}）`;
  if (err?.code === 'resource-exhausted') {
    return '保存できませんでした。Firebase の無料枠の上限に達した可能性があります';
  }
  return `保存できませんでした（${err?.code || err?.message || '不明なエラー'}）`;
}

/* ---------- 同期 ---------- */

const userCol = (name) => fb.collection(db, 'users', uid, name);
const userDoc = (name, id) => fb.doc(db, 'users', uid, name, id);

/** ログインした人のデータの購読を始める。すべての最初のデータが届いたら resolve */
export function startSync(user) {
  stopSync();
  uid = user.uid;
  return new Promise((resolve) => {
    const firstLoaded = { companies: false, sessions: false, trash: false };
    const allLoaded = () => Object.values(firstLoaded).every(Boolean);
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
            if (allLoaded()) resolve();
          }
          if (changed) emitData();
          emitStatus();
        },
        (err) => {
          readError = err;
          emitError(err, 'read');
          emitStatus();
          if (!firstLoaded[name]) {
            firstLoaded[name] = true;
            if (allLoaded()) resolve();
          }
        },
      );
    unsubs = [
      listen('companies', (m) => (companies = m), 'companiesPending'),
      listen('sessions', (m) => (sessions = m), 'sessionsPending'),
      listen('trash', (m) => (trash = m), 'trashPending'),
    ];
  });
}

export function stopSync() {
  unsubs.forEach((u) => u());
  unsubs = [];
  uid = null;
  companies = new Map();
  sessions = new Map();
  trash = new Map();
  Object.assign(status, { companiesPending: false, sessionsPending: false, trashPending: false, fromCache: true });
  readError = null;
  emitStatus();
}

/** サーバーから最新のデータが届くまで待つ（圏外ならつながるまで待つ）。読み込みを断られたら reject */
export function waitForServer() {
  const startUid = uid;
  return new Promise((resolve, reject) => {
    const check = () => {
      if (uid !== startUid) return reject(new Error('signed-out')), true;
      if (readError) return reject(readError), true;
      if (!status.fromCache) return resolve(), true;
      return false;
    };
    if (check()) return;
    const off = onStatus(() => check() && off());
  });
}

/** 同期の状態: 'pending'（未送信の変更あり）| 'offline'（サーバー未確認）| 'synced' */
export function syncStatus() {
  if (status.companiesPending || status.sessionsPending || status.trashPending) return 'pending';
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
  const batch = fb.writeBatch(db);
  batch.set(userDoc('companies', company.id), company);
  // 編集で消した項目はゴミ箱へ（あとから元の位置に戻せるように）
  for (const { field, index } of removedFields(fieldsOf(existing), company.fields)) {
    putTrash(batch, createTrashEntry('field', { companyId: company.id, companyName: company.name, field, index }));
  }
  companies.set(company.id, company);
  fire(batch.commit());
  return company;
}

/** 会社と、その会社の記録をまとめてゴミ箱に移す。戻すときに使うゴミ箱のIDを返す */
export function remove(id) {
  const company = get(id);
  if (!company) throw new Error('この会社は見つかりませんでした');
  const list = sessionsFor(id);
  const entry = createTrashEntry('company', { company, sessions: list });
  const batch = fb.writeBatch(db);
  putTrash(batch, entry);
  batch.delete(userDoc('companies', id));
  for (const s of list) {
    batch.delete(userDoc('sessions', s.id));
    sessions.delete(s.id);
  }
  companies.delete(id);
  fire(batch.commit());
  return entry.id;
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

/** 記録をゴミ箱に移す。戻すときに使うゴミ箱のIDを返す */
export function removeSession(id) {
  const session = getSession(id);
  if (!session) throw new Error('この記録は見つかりませんでした');
  const entry = createTrashEntry('session', { session, companyName: get(session.companyId)?.name ?? '' });
  const batch = fb.writeBatch(db);
  putTrash(batch, entry);
  batch.delete(userDoc('sessions', id));
  sessions.delete(id);
  fire(batch.commit());
  return entry.id;
}

/* ---------- ゴミ箱 ---------- */

function putTrash(batch, entry) {
  batch.set(userDoc('trash', entry.id), entry);
  trash.set(entry.id, entry);
}

/** 新しく消したものが上に来る順 */
export const getTrash = () => sortTrash([...trash.values()]);

/** 戻す先の会社がないときの説明 */
function missingCompanyMessage(companyId, companyName) {
  const inTrash = [...trash.values()].some((e) => e.kind === 'company' && e.company?.id === companyId);
  return inTrash
    ? `先にゴミ箱から会社「${companyName}」を戻してください`
    : `会社「${companyName}」が見つからないため戻せません`;
}

/**
 * ゴミ箱から元の場所に戻す。戻した場所 { companyId, sessionId? } を返す。
 * 戻せないとき（戻す先の会社がないなど）は理由つきで例外を投げ、ゴミ箱には残す。
 */
export function restoreTrash(trashId) {
  const entry = trash.get(trashId);
  if (!entry) throw new Error('ゴミ箱に見つかりませんでした');
  const batch = fb.writeBatch(db);
  let result;
  if (entry.kind === 'company' && entry.company?.id) {
    batch.set(userDoc('companies', entry.company.id), entry.company);
    companies.set(entry.company.id, entry.company);
    for (const s of Array.isArray(entry.sessions) ? entry.sessions : []) {
      batch.set(userDoc('sessions', s.id), s);
      sessions.set(s.id, s);
    }
    result = { companyId: entry.company.id };
  } else if (entry.kind === 'session' && entry.session?.id) {
    const cid = entry.session.companyId;
    if (!get(cid)) throw new Error(missingCompanyMessage(cid, entry.companyName));
    batch.set(userDoc('sessions', entry.session.id), entry.session);
    sessions.set(entry.session.id, entry.session);
    result = { companyId: cid, sessionId: entry.session.id };
  } else if (entry.kind === 'field' && entry.field?.id) {
    const c = get(entry.companyId);
    if (!c) throw new Error(missingCompanyMessage(entry.companyId, entry.companyName));
    const company = { ...c, fields: insertField(fieldsOf(c), entry.field, entry.index), updatedAt: new Date().toISOString() };
    batch.set(userDoc('companies', company.id), company);
    companies.set(company.id, company);
    result = { companyId: company.id };
  } else {
    throw new Error('このデータは戻せません');
  }
  batch.delete(userDoc('trash', trashId));
  trash.delete(trashId);
  fire(batch.commit());
  emitData();
  return result;
}

/** ゴミ箱から完全に削除する（元に戻せない） */
export function deleteTrash(ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter((id) => trash.has(id));
  for (let i = 0; i < list.length; i += 400) {
    const batch = fb.writeBatch(db);
    for (const id of list.slice(i, i + 400)) {
      batch.delete(userDoc('trash', id));
      trash.delete(id);
    }
    fire(batch.commit());
  }
  if (list.length) emitData();
  return list.length;
}

/** 30日たったものを完全に削除する（サーバーの最新の状態が届いてから呼ぶ） */
export function purgeExpiredTrash(now = new Date()) {
  return deleteTrash([...trash.values()].filter((e) => trashDaysLeft(e, now) <= 0).map((e) => e.id));
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

/**
 * まとめて書き込む（同じIDは上書き、それ以外は追加）。1回の書き込みは500件までなので分ける。
 * 画面にはすぐ反映し、戻り値の Promise はサーバーへの保存が確定したら resolve、断られたら reject する
 * （圏外のときはつながるまで待つ）。保存の成否で動きを変えたいときは await すること。
 */
export function importData({ companies: cs, sessions: ss }) {
  const writes = [
    ...cs.map((c) => ['companies', c]),
    ...ss.map((s) => ['sessions', s]),
  ];
  const commits = [];
  for (let i = 0; i < writes.length; i += 400) {
    const batch = fb.writeBatch(db);
    for (const [name, item] of writes.slice(i, i + 400)) {
      batch.set(userDoc(name, item.id), item);
      (name === 'companies' ? companies : sessions).set(item.id, item);
    }
    commits.push(batch.commit());
  }
  if (commits.length) emitData();
  return Promise.all(commits);
}
