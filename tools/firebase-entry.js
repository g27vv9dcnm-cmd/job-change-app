// vendor/firebase.js の元。`npm run build:vendor` でまとめ直す。
// アプリはビルド不要で動かしたいので、Firebase SDK はこの1ファイルにまとめて同梱する。
export { initializeApp } from 'firebase/app';
export {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  inMemoryPersistence,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  connectAuthEmulator,
} from 'firebase/auth';
export {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  collection,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  writeBatch,
  connectFirestoreEmulator,
} from 'firebase/firestore';
