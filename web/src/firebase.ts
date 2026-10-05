// Repaido Firebase Initialization
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// Your web app's Firebase configuration
export const firebaseConfig = {
  apiKey: "AIzaSyAjsYh8UbbnyLUTnPhUf6ZW34vJkPBruz4",
  authDomain: "repaido.firebaseapp.com",
  projectId: "repaido",
  storageBucket: "repaido.firebasestorage.app",
  messagingSenderId: "133610574058",
  appId: "1:133610574058:web:cd93be2b8b270bf2a84793",
  measurementId: "G-WZZKY488SN"
};

// Initialize Firebase (singleton pattern to avoid re-init in Vite HMR)
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Firebase Auth & Firestore instances for unified web + android database
export const auth = getAuth(app);
export const db = getFirestore(app);

// Safe Analytics initialization (only in supported browser environments)
export let analytics: ReturnType<typeof getAnalytics> | null = null;
if (typeof window !== 'undefined') {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  }).catch(() => {
    // Analytics blocked or not supported in environment
  });
}

export default app;
