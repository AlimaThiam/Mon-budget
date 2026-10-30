# Mon Budget

Application web gratuite pour gérer son budget : argent du mois, dépenses, dépenses fixes, budgets par catégorie, épargne, bilan et conseils.

- Fonctionne sur téléphone et ordinateur, et s'installe comme une appli.
- Marche sans connexion une fois ouverte une première fois.
- Pas de compte : les données de chaque personne restent sur son propre appareil (stockage du navigateur). Bouton « Sauvegarder (JSON) » pour garder une copie ou changer d'appareil.

## Fichiers

- `index.html` : toute l'application (HTML, CSS, JavaScript).
- `manifest.json` : nom, couleurs et icônes pour l'installation sur téléphone.
- `sw.js` : service worker qui permet l'utilisation hors ligne.
- `icons/` : icônes de l'application.

## Mettre en ligne gratuitement avec GitHub Pages

1. Crée un dépôt public sur GitHub (par exemple `mon-budget`).
2. Mets-y tous les fichiers de ce dossier.
3. Dans le dépôt : **Settings → Pages → Source : Deploy from a branch → Branch : main / (root)**, puis enregistre.
4. Après une minute, l'appli est disponible à `https://<ton-pseudo>.github.io/mon-budget/`.

## Installer sur un téléphone

- **Android (Chrome)** : ouvrir le lien, puis menu ⋮ → « Installer l'application » ou « Ajouter à l'écran d'accueil ».
- **iPhone (Safari)** : ouvrir le lien, bouton Partager → « Sur l'écran d'accueil ».

## Après une mise à jour

Changer `VERSION` dans `sw.js` (par exemple `mon-budget-v2`) pour que les téléphones récupèrent la nouvelle version.
