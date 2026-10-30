// Mon Budget: optional account (e-mail or Google) that keeps the data online, on every device.
// Loaded as a module after app.js; does nothing until firebase-config.js holds a project.
import config from "./firebase-config.js";

const FIREBASE = "https://www.gstatic.com/firebasejs/10.12.2/";
const $ = (id) => document.getElementById(id);
const App = window.MonBudget;

const ERRORS = {
  "auth/invalid-credential": "E-mail ou mot de passe incorrect.",
  "auth/wrong-password": "E-mail ou mot de passe incorrect.",
  "auth/user-not-found": "Aucun compte avec cet e-mail. Clique sur « Créer un compte ».",
  "auth/invalid-email": "Cette adresse e-mail n'est pas valide.",
  "auth/missing-password": "Indique ton mot de passe.",
  "auth/email-already-in-use": "Un compte existe déjà avec cet e-mail. Clique sur « Se connecter ».",
  "auth/weak-password": "Choisis un mot de passe d'au moins 6 caractères.",
  "auth/too-many-requests": "Trop d'essais. Patiente quelques minutes puis réessaie.",
  "auth/network-request-failed": "Pas de connexion internet. Réessaie quand tu seras connecté.",
  "auth/popup-closed-by-user": "Connexion Google annulée.",
  "auth/cancelled-popup-request": "Connexion Google annulée.",
  "auth/popup-blocked": "Le navigateur a bloqué la fenêtre Google. Autorise les fenêtres pop-up ou utilise ton e-mail.",
  "auth/operation-not-supported-in-this-environment": "La connexion Google ne marche pas ici. Utilise ton e-mail et un mot de passe.",
  "auth/operation-not-allowed": "Ce mode de connexion n'est pas encore activé pour l'appli.",
  "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "L'appli est mal configurée (clé Firebase invalide). Vérifie firebase-config.js.",
  "auth/invalid-api-key": "L'appli est mal configurée (clé Firebase invalide). Vérifie firebase-config.js.",
  "auth/unauthorized-domain": "Ce site n'est pas autorisé dans Firebase (Authentication → Paramètres → Domaines autorisés).",
};
// Without internet, Firestore keeps writes queued and their promise waits; don't block the app on it.
const within = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error("timeout")), ms))]);
const say = (text, kind) => { $("aMsg").textContent = text; $("aMsg").dataset.kind = kind || ""; };
const fail = (e) => say(ERRORS[e?.code] || "Ça n'a pas marché. Réessaie dans un instant.", "warn");

if (config && App) start().catch(() => say("Le service de compte ne répond pas. Réessaie plus tard ; en attendant, tes données restent sur cet appareil.", "warn"));

async function start() {
  $("syncBox").hidden = false;
  const [{ initializeApp }, A, F] = await Promise.all([
    import(FIREBASE + "firebase-app.js"),
    import(FIREBASE + "firebase-auth.js"),
    import(FIREBASE + "firebase-firestore.js"),
  ]);
  const app = initializeApp(config);
  const auth = A.getAuth(app);
  auth.languageCode = "fr";
  let db;
  try {
    db = F.initializeFirestore(app, { ignoreUndefinedProperties: true, localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  } catch {
    db = F.initializeFirestore(app, { ignoreUndefinedProperties: true }); // no offline cache (private browsing)
  }

  const refs = (uid) => ({
    txs: F.collection(db, "users", uid, "transactions"),
    settings: F.doc(db, "users", uid, "meta", "settings"),
  });

  // Firestore allows 500 writes per batch.
  async function commitAll(ops) {
    for (let i = 0; i < ops.length; i += 450) {
      const batch = F.writeBatch(db);
      ops.slice(i, i + 450).forEach((op) => op(batch));
      await batch.commit();
    }
  }

  const api = (uid) => {
    const r = refs(uid);
    const meta = (snap) => ({ pending: snap.metadata.hasPendingWrites, fromCache: snap.metadata.fromCache });
    return {
      onTxs: (cb, err) => F.onSnapshot(r.txs, { includeMetadataChanges: true }, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })), meta(snap)), err),
      onSettings: (cb, err) => F.onSnapshot(r.settings, { includeMetadataChanges: true }, (snap) => cb(snap.exists() ? snap.data() : null, meta(snap)), err),
      setTx: (id, t) => F.setDoc(F.doc(r.txs, id), t),
      delTx: (id) => F.deleteDoc(F.doc(r.txs, id)),
      setSettings: (s) => F.setDoc(r.settings, s),
      async replaceAll(txs, settings) {
        const keep = new Set(txs.map((t) => t.id));
        const old = await F.getDocs(r.txs);
        const ops = old.docs.filter((d) => !keep.has(d.id)).map((d) => (b) => b.delete(d.ref));
        txs.forEach(({ id, ...t }) => ops.push((b) => b.set(F.doc(r.txs, id), t)));
        ops.push((b) => b.set(r.settings, settings));
        await commitAll(ops);
      },
    };
  };

  // First sign-in on a device: what was entered without an account joins the account.
  // Operation ids are kept, so running it twice never duplicates anything.
  async function bringLocalData(uid) {
    const local = App.readLocal();
    if (!local.txs.length && !local.settings) return "";
    const r = refs(uid);
    let hasSettings = true;
    try { hasSettings = (await within(F.getDoc(r.settings), 8000)).exists(); } catch { hasSettings = true; }
    const ops = local.txs.map(({ id, ...t }) => (b) => b.set(F.doc(r.txs, id), t));
    if (local.settings && !hasSettings) ops.push((b) => b.set(r.settings, local.settings));
    try {
      await within(commitAll(ops), 10000);
      App.clearLocal();
      return local.txs.length ? local.txs.length + " opération(s) de cet appareil ajoutée(s) à ton compte." : "";
    } catch {
      return "Les opérations de cet appareil seront ajoutées à ton compte à la prochaine connexion internet.";
    }
  }

  let current = null;
  A.onAuthStateChanged(auth, async (user) => {
    const uid = user?.uid || null;
    if (uid === current) return;
    const wasIn = current !== null;
    current = uid;
    $("aOut").hidden = !!user;
    $("aIn").hidden = !user;
    if (!user) {
      $("aSummary").textContent = "Retrouver mes données sur tous mes appareils";
      if (wasIn) App.useLocal("Tu es déconnecté. Tes données restent dans ton compte : reconnecte-toi pour les retrouver.");
      return;
    }
    $("aWho").textContent = user.email || "ton compte Google";
    $("aSummary").textContent = "Compte : " + (user.email || "Google");
    $("syncBox").open = false;
    App.setStatus("Connexion à ton compte…");
    const note = await bringLocalData(uid);
    App.useCloud(api(uid));
    say(note);
  });

  const creds = () => ({ email: $("aEmail").value.trim(), pass: $("aPass").value });
  const busy = async (fn) => {
    const btns = $("syncBox").querySelectorAll("button");
    btns.forEach((b) => (b.disabled = true));
    try { await fn(); } catch (e) { fail(e); } finally { btns.forEach((b) => (b.disabled = false)); }
  };

  $("aForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const { email, pass } = creds();
    say("");
    busy(() => A.signInWithEmailAndPassword(auth, email, pass));
  });
  $("aSignup").addEventListener("click", () => {
    const { email, pass } = creds();
    if (pass.length < 6) { say("Choisis un mot de passe d'au moins 6 caractères.", "warn"); return; }
    say("");
    busy(() => A.createUserWithEmailAndPassword(auth, email, pass));
  });
  $("aGoogle").addEventListener("click", () => { say(""); busy(() => A.signInWithPopup(auth, new A.GoogleAuthProvider())); });
  $("aReset").addEventListener("click", () => {
    const { email } = creds();
    if (!email) { say("Écris d'abord ton e-mail, puis clique sur « Mot de passe oublié ».", "warn"); $("aEmail").focus(); return; }
    busy(async () => { await A.sendPasswordResetEmail(auth, email); say("Un e-mail pour changer ton mot de passe a été envoyé à " + email + "."); });
  });
  $("aLogout").addEventListener("click", () => busy(() => A.signOut(auth)));
}
