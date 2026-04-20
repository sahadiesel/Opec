/** ค่า storageBucket ต้องตรง Firebase Console → Project settings → Your apps (หรือ Build → Storage) */
const PROJECT_ID = 'studio-9554558161-dc547';

export const firebaseConfig = {
  projectId: PROJECT_ID,
  appId: '1:260259212048:web:1766524f6a15f4087e1395',
  apiKey: 'AIzaSyBz7AUVlUS2VMjGyJKO2hPbAQPumj7AuRc',
  authDomain: `${PROJECT_ID}.firebaseapp.com`,
  measurementId: '',
  messagingSenderId: '260259212048',
  /** โปรเจกต์ใหม่มักใช้ *.firebasestorage.app — โปรเจกต์เก่าอาจเป็น *.appspot.com ตั้ง NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ถ้าอัปโหลดยังผิด bucket */
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    `${PROJECT_ID}.firebasestorage.app`,
};
