# Changelog

## 1.3.3
- **Icône redessinée** : silhouette de poste de radio portative originale (poignée de transport, antenne télescopique),
  autour de la forme d'onde et des guides. Les icônes sont couvertes par la GPL-3.0 comme le reste du dépôt.
- Capture de l'icône dans la barre d'outils retirée du README (à refaire avec la nouvelle icône).

## 1.3.2
- **Licence : GNU GPL v3.0** (au lieu de MIT) ; notice de copyright dans les fichiers source.
- Les zips de release incluent désormais `LICENSE`, `THIRD_PARTY_NOTICES.md` et le texte de licence de lamejs.

## 1.3.1
- Éditeur : par défaut, la sélection couvre **tout le fichier** (guide de fin tout à droite) au lieu de 30 s,
  ce qui évitait des guides collés au début sur les longs épisodes.
- Éditeur : la barre de progression est masquée une fois l'analyse terminée.
- Captures d'écran ajoutées au README (`docs/`).

## 1.3.0
- **Renommée « RF Sampler »**.
- Nouvelle icône : poste de radio portable autour de la forme d'onde et des guides début/fin ; version simplifiée
  pour les petites tailles (16/32 px) et liseré clair pour rester lisible en thème sombre.
- Sources SVG des icônes dans `assets/` et script `npm run icons`.

## 1.2.1
- Icônes, nom précisant « non officiel », documentation, licence, tests automatisés et publication des versions via GitHub.

## 1.2.0
- **Éditeur d'extrait** : spectrogramme + forme d'onde, échelle de temps, guides début/fin, zoom, écoute, export
  sans perte (m4a/mp3) ou en MP3.
- Détection de l'épisode via le JSON-LD de la page ; prise en charge des fichiers `.m4a` et `.aac` ;
  les épisodes simplement *cités* dans la page sont listés à part.
- Commande ffmpeg copiable pour convertir un m4a en MP3.

## 1.0.0
- Première version : détection et téléchargement des `.mp3` d'une page de podcast.
