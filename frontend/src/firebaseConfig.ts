import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyAqGacIQCimwMxcALy_s2hhCTt1KDhiVfw",
  authDomain: "ethereum-address-scraper.firebaseapp.com",
  projectId: "ethereum-address-scraper",
  storageBucket: "ethereum-address-scraper.appspot.com",
  messagingSenderId: "179669209059",
  appId: "1:179669209059:web:d16d515c1e402f8a4d9ad6",
  measurementId: "G-VDW9VQD0BZ",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const signInWithGoogle = async () => {
  const result = await signInWithPopup(auth, provider);
  return result.user;
};

const signOutFromApp = async () => {
  await signOut(auth);
};

export { auth, signInWithGoogle, signOutFromApp };
