// ─── Firebase Client ───────────────────────────────────────────────────────────
// CDN scripts loaded in HTML before this script

const firebaseConfig = {
  apiKey: "AIzaSyBzNYSoeTkuES7b8Z8kp9SqA9-e5dL55_k",
  authDomain: "flow-timer-a792e.firebaseapp.com",
  projectId: "flow-timer-a792e",
  storageBucket: "flow-timer-a792e.firebasestorage.app",
  messagingSenderId: "211862276460",
  appId: "1:211862276460:web:1506bdfbdb8a699ab10b49"
};

firebase.initializeApp(firebaseConfig);

const _db   = firebase.firestore();
const _auth = firebase.auth();
