// クラウド同期を入れる前の版（端末内の IndexedDB に保存していた版）のデータを読み出す。
// 初回ログイン時にクラウドへ移すためだけに使い、元のデータは消さない（念のための控え）。
const DB_NAME = 'job-change-app';
const STORE = 'companies';

export async function readLegacyCompanies() {
  if (!('indexedDB' in globalThis)) return [];
  if (indexedDB.databases) {
    try {
      const dbs = await indexedDB.databases();
      if (!dbs.some((d) => d.name === DB_NAME)) return [];
    } catch {
      // databases() が使えない環境はそのまま開いてみる
    }
  }
  return new Promise((resolve) => {
    let created = false;
    const req = indexedDB.open(DB_NAME);
    req.onupgradeneeded = () => {
      // 旧データが無い端末。空のDBを作ってしまったので後で消す
      created = true;
    };
    req.onerror = () => resolve([]);
    req.onsuccess = () => {
      const db = req.result;
      if (created || !db.objectStoreNames.contains(STORE)) {
        db.close();
        if (created) indexedDB.deleteDatabase(DB_NAME);
        resolve([]);
        return;
      }
      const all = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      all.onsuccess = () => {
        db.close();
        resolve(Array.isArray(all.result) ? all.result : []);
      };
      all.onerror = () => {
        db.close();
        resolve([]);
      };
    };
  });
}
