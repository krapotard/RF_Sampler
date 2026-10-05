# Politique de confidentialité — RF Sampler

**En bref : l'extension ne collecte, ne transmet et ne stocke aucune donnée personnelle.**

## Ce qui se passe, et où
- Tout le traitement (détection, analyse du spectre, découpe, encodage MP3) a lieu **dans ton navigateur**.
- Les seules requêtes réseau sont celles de **ton navigateur vers `radiofrance.fr` et
  `radiofrance-podcast.net`** : lecture de la page que tu consultes, et téléchargement du fichier audio quand tu
  le demandes (bouton *Télécharger* ou ouverture de l'éditeur).
- Aucun serveur de l'auteur, aucune mesure d'audience, aucun traceur, aucun code chargé à distance
  (l'encodeur MP3 est embarqué dans l'extension).
- Les fichiers téléchargés ou exportés vont dans ton dossier de téléchargements habituel.

## Données conservées localement
- La liste des adresses de fichiers audio repérées par onglet est gardée en mémoire de session
  (`chrome.storage.session`) : elle est effacée à la fermeture de l'onglet ou du navigateur.
- Rien d'autre n'est enregistré.

## Permissions demandées
| Permission | Pourquoi |
|---|---|
| `activeTab`, `scripting` | Lire le code de la page d'épisode ouverte (quand tu cliques sur l'icône) pour retrouver l'adresse du fichier audio. |
| `webRequest` | Repérer, sur radiofrance.fr, les requêtes de fichiers audio émises pendant la lecture (méthode de secours). Lecture seule, aucune modification de requête. |
| `downloads` | Enregistrer le fichier audio dans ton dossier de téléchargements. |
| `storage` | Mémoire de session décrite ci-dessus. |
| Accès à `*.radiofrance.fr` et `*.radiofrance-podcast.net` | Détection sur le site et téléchargement des fichiers audio par l'éditeur. L'extension ne s'active sur aucun autre site. |

## Contact
Questions ou signalements : ouvre une *issue* sur le dépôt GitHub du projet.
