// Firebase の設定値（Firebase コンソール →「プロジェクトの設定」→「マイアプリ」に表示されるもの）。
// これらは公開しても問題ない値で、データはログインと Firestore のルールで守られる。
const productionConfig = {
  apiKey: 'AIzaSyAm-cj3Voq1ytmD1p_RSAUcWmbErZsxsrY',
  authDomain: 'job-change-682d2.firebaseapp.com',
  projectId: 'job-change-682d2',
  storageBucket: 'job-change-682d2.firebasestorage.app',
  messagingSenderId: '94576614003',
  appId: '1:94576614003:web:36e42e6ce4cd26be44a806',
};

// localhost で開いたときは Firebase Emulator（テスト用の仮サーバー）につなぐ
export const useEmulator = ['localhost', '127.0.0.1'].includes(location.hostname);

export const firebaseConfig = useEmulator
  ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-job-change' }
  : productionConfig;
