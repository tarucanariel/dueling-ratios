/* =========================================================
   Firebase setup — Realtime Database + Anonymous Auth only.
   (analytics is intentionally omitted: it's unrelated to gameplay
   and adds bundle weight / setup requirements we don't need.)
   ========================================================= */

import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCjyMidGnpDzArLBRPU0Gy1fW3lC_cn80M",
  authDomain: "dueling-ratios.firebaseapp.com",
  databaseURL: "https://dueling-ratios-default-rtdb.firebaseio.com",
  projectId: "dueling-ratios",
  storageBucket: "dueling-ratios.firebasestorage.app",
  messagingSenderId: "788955705989",
  appId: "1:788955705989:web:8c896a363134c21b5aefec",
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);

/* Resolves once we have an anonymous, signed-in user. There's no login
   screen involved — this just gives each browser tab a stable uid so
   Realtime Database security rules can tell "someone" from "no one". */
let signInPromise = null;
export function ensureSignedIn(){
  if(signInPromise) return signInPromise;
  signInPromise = new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if(user){
        unsubscribe();
        resolve(user);
      }
    }, reject);
    signInAnonymously(auth).catch((err) => {
      unsubscribe();
      reject(err);
    });
  });
  return signInPromise;
}
