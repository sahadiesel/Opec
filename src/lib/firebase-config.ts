import type { FirebaseOptions } from 'firebase/app';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

import { FIRESTORE_DATABASE_ID, firebaseConfig } from '@/firebase/config';
import { getNamedStorage } from '@/firebase/named-storage';

const app =
  getApps().length > 0 ? getApp() : initializeApp(firebaseConfig as FirebaseOptions);

const auth = getAuth(app);
const db = getFirestore(app, FIRESTORE_DATABASE_ID);
const storage = getNamedStorage(app);

export { auth, db, storage };
