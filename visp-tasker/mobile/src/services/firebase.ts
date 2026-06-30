import { initializeApp } from "firebase/app";
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";
import { getReactNativePersistence, initializeAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from 'firebase/functions';

const firebaseConfig = {
    apiKey: "AIzaSyC-xRhI2y1iPC1CvHJtgkE_edWdxFs0xLc",
    authDomain: "task-app-58916.firebaseapp.com",
    projectId: "task-app-58916",
    storageBucket: "task-app-58916.firebasestorage.app",
    messagingSenderId: "204697608384",
    appId: "1:204697608384:web:8ea61a7caa47c316108d25",
};

const app = initializeApp(firebaseConfig);

const auth = initializeAuth(app, {
    persistence: getReactNativePersistence(ReactNativeAsyncStorage),
});

const db = getFirestore(app);
const functions = getFunctions(app);

export { auth, db, functions };
