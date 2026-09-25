# Point d'étape — reprise à la prochaine session

État au 25/09/2026, branche `claude/game-engine-multimedia-k8e3i1` (dépôt `Hashiragaki/claude`).

## Récupérer le projet

- Archive : <https://github.com/Hashiragaki/claude/archive/refs/heads/claude/game-engine-multimedia-k8e3i1.zip>
  (dépôt privé : être connecté à GitHub).
- Ou : `git clone https://github.com/Hashiragaki/claude.git && cd claude && git checkout claude/game-engine-multimedia-k8e3i1`
- Puis : `pnpm install` et `pnpm dev` → <http://127.0.0.1:5173> (serveur sur :8787).
  Optionnel : `cp .env.example .env` et renseigner `ANTHROPIC_API_KEY` (sinon mode procédural hors-ligne).
- Reprendre la conversation avec Claude en local : `claude --teleport` dans le dossier du dépôt.

## Ce qui est fait et vérifié

| Domaine | État |
|---|---|
| Modes | Visual Novel, RPG, Plateformer 2D, Bac à sable 3D — tous joués dans Chromium sans erreur console |
| Génération | Images SVG, pixel-art, charsets, tilesets (vue de dessus et de côté), animations 2D, sons, musiques, modèles 3D GLB ; repli procédural |
| IA | Critique visuelle des rendus, routage modèle/effort par rôle avec escalade, outils stricts, journal des coûts + budget par projet |
| Planification | Kanban, calendrier/Gantt, jalons, mémoire, chat hors-ligne (`/tache`…), pilote automatique |
| Éditeur | Interface sombre dockable (React Spectrum), éditeurs de script, carte, base de données, scène 3D, niveaux ; panneau Coûts IA |
| Export | Zip autonome vérifié (joué depuis un serveur statique) |
| Qualité | 540 tests unitaires, e2e Playwright 4/4, build OK, Prettier, CI GitHub Actions (pas encore exécutée sur GitHub) |

Commandes utiles : `pnpm check` (types + tests + format par package), `pnpm e2e`, `pnpm build`,
`node scripts/snap.mjs --template <modèle>` (captures d'un jeu), modèles : `vn-demo`, `rpg-demo`, `platformer-demo`,
`sandbox3d-demo` (et les variantes vides).

## À faire ensuite (par priorité)

1. **Ouvrir une pull request** vers la branche principale et vérifier que la CI passe sur GitHub.
2. **Essai réel avec une clé API** (coût à valider avant) : générer un portrait, un charset, un tileset, un son, un
   modèle 3D ; vérifier la critique visuelle, l'escalade et les chiffres du panneau Coûts IA (prix par défaut = estimations
   à confirmer sur la page de tarifs d'Anthropic, surchargeables par `FORGE_PRICES`).
3. **Optimisations IA restantes** (plan, section B) : cache et réutilisation des specs d'assets (E4), génération par lots
   avec l'API Batches (E5), pilote automatique parallèle (E6), outils du chat paginés + cache 1 h (E7), critique visuelle
   seulement sur rendu suspect (E8), petite évaluation par générateur pour régler modèles/efforts (E9).
4. **Pistes produit non retenues pour l'instant** : direction artistique du projet (B2), génération par lots depuis le
   script (B3), voix « babillage » (B4), mode point & click (B6), éditeur visuel des commandes RPG + autotiles (B7),
   éditeur 3D direct (B8), revues planifiées (B10), suivi du temps + iCal (B11), PWA/mobile (B14), import Ren'Py / RPG Maker
   (B15), historique du projet (B16).
5. Petits points connus : icône du site (favicon) absente dans l'export ; le plateformer affiche un personnage assez grand
   (zoom 3) à régler selon les goûts ; la liste des mots-clés refusés par le mode strict des outils est prudente, à ajuster.

## Méthode de travail avec les agents (à conserver)

- Contrats écrits d'abord par l'agent principal, puis sous-agents Sonnet sur des fichiers disjoints, un vérificateur
  Sonnet par unité, Haiku pour le mécanique ; Opus seulement pour l'intégration et en escalade.
- Workflows réutilisables : `.claude/workflows/forge-find.js` (revue) et `forge-fix.js` (correction + vérification).
- **Ne pas activer le mode plan pendant qu'un workflow tourne** : les agents en cours deviennent incapables d'écrire.
- Plan détaillé de l'historique : phases 1 à 3 (conception, finalisation, optimisation de l'IA).
