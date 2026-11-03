// Firebase の設定値（Firebase コンソール →「プロジェクトの設定」→「マイアプリ」に表示されるもの）。
// これらは公開しても問題ない値で、データはログインと Firestore のルールで守られる。
const productionConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};

// localhost で開いたときは Firebase Emulator（テスト用の仮サーバー）につなぐ
export const useEmulator = ['localhost', '127.0.0.1'].includes(location.hostname);

export const firebaseConfig = useEmulator
  ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-job-change' }
  : productionConfig;
