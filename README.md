# Forge — moteur de jeu web assisté par IA

Forge est un moteur et un éditeur de jeux vidéo qui tournent dans le navigateur. Il réunit quatre piliers :

1. **Génération d'images** : illustrations et décors vectoriels, portraits de personnages avec expressions, monstres, objets, pixel-art.
2. **Génération d'assets de jeu** : personnages RPG animés (charsets), tilesets, animations 2D, effets sonores, musiques, modèles 3D animés (glTF).
3. **Modes de jeu préinstallés** : *Visual Novel* (langage de script inspiré de Ren'Py), *RPG* (inspiré de RPG Maker : cartes, événements, combats), *Bac à sable 3D*.
4. **Planification long terme avec un assistant** : jalons, tâches, dépendances, calendrier, revue d'avancement et mémoire du projet, pilotés depuis un chat.

Il n'utilise aucun service de génération externe : **c'est Claude qui génère tout**, sous forme de données (SVG, grilles de pixels, partitions, paramètres de synthé, description 3D) que le moteur rend localement. Sans clé API, chaque générateur a un **mode procédural** hors-ligne, et l'assistant comprend des commandes (`/tache`, `/revue`…).

L'interface reprend les codes des suites créatives : thème sombre, panneaux dockables, rail d'outils vertical. Elle est construite avec [React Spectrum](https://react-spectrum.adobe.com/) (design system open source, licence Apache-2.0). Aucun service Adobe n'est utilisé.

---

## Démarrage rapide

Prérequis : **Node.js 22+** et **pnpm 10+**.

```bash
pnpm install
cp .env.example .env        # facultatif : renseignez ANTHROPIC_API_KEY pour activer l'IA
pnpm dev                    # serveur (http://127.0.0.1:8787) + éditeur (http://127.0.0.1:5173)
```

Ouvrez <http://127.0.0.1:5173>, choisissez un modèle (« Démo : Le Café des Étoiles », « Démo : Le Village de Brume », « Démo : La Clairière »…) et cliquez sur **Jouer**.

Pour une installation « production » (éditeur servi par le serveur, export web activé) :

```bash
pnpm build                  # typecheck + build de l'éditeur et du lecteur autonome
pnpm start                  # http://127.0.0.1:8787
```

### Configuration (`.env`)

| Variable | Rôle | Défaut |
|---|---|---|
| `ANTHROPIC_API_KEY` | Active l'assistant et la génération par Claude | — (mode procédural) |
| `FORGE_MODEL` | Modèle Claude utilisé | `claude-opus-5` |
| `FORGE_EFFORT` | Effort du modèle : `low`, `medium`, `high`, `xhigh`, `max` | celui du modèle |
| `FORGE_REFUSAL_FALLBACK` | Repli serveur vers un autre modèle si une demande est refusée | `on` |
| `FORGE_AI` | `auto` (si clé présente), `on`, `off` | `auto` |
| `FORGE_DATA_DIR` | Dossier des projets | `./workspace` |
| `PORT` | Port du serveur | `8787` |
| `FORGE_JOB_CONCURRENCY` | Générations simultanées | `2` |

---

## L'éditeur

| Zone | Contenu |
|---|---|
| Barre du haut | Menus Fichier / Fenêtre, nom du projet, état de l'IA, bouton **Jouer** |
| Rail d'outils (gauche) | Jeu, éditeurs du mode (script, cartes, base de données, scène 3D), planning, panneaux |
| Centre | Onglets : **Jeu** (lecture dans l'éditeur), **Planning**, documents ouverts |
| Droite | **Assistant IA** (chat) et **Propriétés** (asset ou projet sélectionné) |
| Bas | **Assets**, **Fichiers**, **Console** (journaux + diagnostics), **Inspecteur** (variables du jeu en direct, modifiables) |

Tous les panneaux se déplacent, s'empilent en onglets ou flottent (glisser-déposer). *Fenêtre → Réinitialiser la disposition* restaure l'agencement par défaut.

### Assets

- **Générer** : choisissez un type (image vectorielle, pixel-art, personnage RPG, tileset, animation 2D, effet sonore, musique, modèle 3D), décrivez-le et ajustez ses paramètres. Moteur *IA*, *procédural* ou *automatique*.
- **Alias** : chaque asset peut porter un alias (`bg cafe`, `mina joyeuse`, `tiles village`) utilisé par les scripts et les cartes. Une nouvelle version reprend l'alias : les scripts utilisent toujours la plus récente.
- **Variantes et retouches** : « Nouvelle variante » régénère avec une autre graine ; « Retoucher avec l'IA » modifie l'asset selon une instruction (« rends le ciel plus orageux »). L'historique des versions est conservé.
- **Import** : PNG, JPG, WebP, SVG, WAV, MP3, OGG, GLB.

### Assistant IA et planification

L'assistant (Claude) voit à chaque message l'état du projet, le planning et la **mémoire du projet**. Il peut :

- planifier (`plan_project`, `create_task`, `update_task`, jalons, dépendances, échéances, tâches récurrentes) et faire des revues d'avancement ;
- mémoriser les décisions durables (univers, personnages, style) ;
- lire et écrire les fichiers du projet (scripts, cartes, données) en vérifiant les erreurs ;
- générer des assets et réaliser lui-même les tâches qui lui sont confiées.

Le planning s'affiche en **tableau Kanban** (glisser-déposer), **calendrier** (Gantt calculé d'après les estimations, les dépendances et vos heures disponibles), **jalons** et **mémoire**. Les conversations sont conservées (et archivées quand on repart de zéro) ; les longues conversations sont compactées automatiquement.

Sans clé API, le chat accepte : `/tache Titre !haute @2026-10-01 ~3h #art`, `/taches`, `/fait <id ou titre>`, `/encours <…>`, `/jalon Titre @date`, `/revue`, `/note Texte`, `/generer <générateur> <description>`, `/aide`.

### Export

*Fichier → Exporter pour le web* produit un `.zip` autonome (lecteur + fichiers du projet) à déposer sur n'importe quel hébergement statique. Nécessite `pnpm build`.

---

## Les modes de jeu

<!-- MODES -->

---

## Architecture

```
packages/
  core/            runtime : boucle de jeu, entrées (clavier, souris, manette), audio, sauvegardes,
                   langage d'expressions sûr, format projet, registre des modes, tuiles standard
  render2d/        rendu PixiJS : scène, textures, fenêtre de dialogue, menus, fondus, animations
  render3d/        rendu Three.js : vue, glTF, animations, caméra 3e personne, visionneuse de modèles
  mode-vn/         Visual Novel (parseur, compilateur, interpréteur avec retour arrière, rendu)
  mode-rpg/        RPG (monde, événements, combats, base de données, constructeur de cartes, rendu)
  mode-sandbox3d/  Bac à sable 3D (scène, déplacements, collisions, interactions)
  generators/      générateurs d'assets : spec IA validée → rendu (PNG, WAV, GLB…) + repli procédural
  ai/              client Claude, génération structurée validée (zod) avec correction automatique,
                   boucle d'agent à outils en streaming
  planner/         planification : tâches, jalons, dépendances, calendrier, mémoire, outils de l'agent
apps/
  server/          Fastify : projets sur disque, file de générations, SSE, chat, export
  editor/          éditeur React + React Spectrum + dockview, lecteur autonome pour l'export
```

Principes :

- **L'IA produit des données, jamais du code exécuté.** Chaque générateur définit un schéma (zod) ; la réponse de Claude est validée, et en cas d'erreur les problèmes lui sont renvoyés pour correction. Les SVG sont assainis avant rendu.
- **Logique pure et testée, rendu séparé.** Les interpréteurs VN et RPG, les combats, le planning, les générateurs… sont testés sans navigateur ; PixiJS et Three.js ne sont chargés qu'à l'exécution du jeu.
- **Projets = fichiers lisibles** : `project.json` (manifeste + assets), scripts `.vn`, cartes et données JSON, `planner.json`, journal du chat. Versionnables avec git.

## Tests

```bash
pnpm typecheck     # TypeScript strict sur tous les packages
pnpm test          # tests unitaires et d'intégration (Vitest)
pnpm e2e           # parcours complet dans Chromium (Playwright) avec captures d'écran
```

## Feuille de route

- Autotiles et outils de carte avancés (calques de régions, copier-coller de zones).
- Nouveaux modes : plateformer 2D, point & click.
- Éditeur visuel des commandes d'événements RPG plus complet, éditeur de scène 3D avec manipulation directe.
- Doublage (voix) et localisation des textes de jeu.
- Collaboration temps réel et historique Git intégré.
