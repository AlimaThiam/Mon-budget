# Activer les comptes (synchronisation entre appareils)

Environ 10 minutes, gratuit, sans carte bancaire (offre « Spark » de Firebase).

## 1. Créer le projet

1. Va sur https://console.firebase.google.com et connecte-toi avec ton compte Google.
2. **Créer un projet** → nom : `mon-budget` → tu peux désactiver Google Analytics → **Créer**.

## 2. Activer la connexion

1. Menu de gauche : **Créer → Authentication** → **Commencer**.
2. Onglet **Mode de connexion (Sign-in method)** :
   - **Adresse e-mail/Mot de passe** → Activer → Enregistrer.
   - **Google** → Activer → choisis ton e-mail d'assistance → Enregistrer.
3. Onglet **Paramètres → Domaines autorisés** → **Ajouter un domaine** : `alimathiam.github.io`.

## 3. Créer la base de données

1. Menu de gauche : **Créer → Firestore Database** → **Créer une base de données**.
2. Emplacement : choisis `eur3 (europe-west)` (le plus proche du Sénégal) → Suivant.
3. Choisis **Démarrer en mode production** → Créer.
4. Onglet **Règles** : remplace tout le texte par le contenu du fichier [`firestore.rules`](../firestore.rules) de ce projet, puis **Publier**.
   Ces règles font que chaque personne ne peut lire et modifier que son propre budget.

## 4. Relier l'appli au projet

1. Roue dentée en haut à gauche → **Paramètres du projet**.
2. En bas, **Vos applications** → icône **`</>`** (Web) → surnom : `Mon Budget` → **Enregistrer l'application** (pas besoin de Firebase Hosting).
3. Firebase affiche un bloc `const firebaseConfig = { ... }`. Copie seulement ce qui est entre les accolades.
4. Dans [`firebase-config.js`](../firebase-config.js), remplace `export default null;` par :

   ```js
   export default {
     apiKey: "…",
     authDomain: "mon-budget-xxxx.firebaseapp.com",
     projectId: "mon-budget-xxxx",
     storageBucket: "…",
     messagingSenderId: "…",
     appId: "…",
   };
   ```

   Ces valeurs ne sont pas secrètes : elles peuvent être publiées sur GitHub. Ce sont les règles de l'étape 3 qui protègent les données.

5. Dans `sw.js`, change `VERSION` (par exemple `mon-budget-v5`), puis envoie les changements sur GitHub.

## Vérifier

Ouvre l'appli, clique sur **« Retrouver mes données sur tous mes appareils »**, crée un compte, ajoute une dépense, puis connecte-toi sur un autre téléphone : la dépense doit y apparaître.

## Bon à savoir

- **Limites gratuites** : 50 000 lectures et 20 000 écritures par jour, 1 Go de données. Largement assez pour des centaines d'utilisateurs.
- **Voir les comptes** : Authentication → Utilisateurs. Tu peux y supprimer un compte si quelqu'un le demande (pense à supprimer aussi ses données dans Firestore, dossier `users/<son identifiant>`).
- **Connexion par SMS** : possible avec Firebase, mais payante (offre Blaze), c'est pourquoi l'appli utilise l'e-mail et Google.
