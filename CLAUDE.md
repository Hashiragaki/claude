# Forge — consignes pour les agents

Moteur/éditeur de jeux web : génération d'assets par Claude (données rendues localement, repli procédural
hors-ligne), modes de jeu en plugins, planificateur long terme avec chat. Monorepo pnpm.

## Carte
- `packages/core` : runtime (boucle, entrées, audio, sauvegardes, langage d'expressions sûr), format projet (zod),
  `mode.ts` (contrat `GameModeDefinition`/`GameRuntime`), `tiles.ts` (rôles de tuiles vue de dessus et de côté).
- `packages/render2d` (Pixi 8), `packages/render3d` (three).
- `packages/mode-vn` (Ren'Py), `mode-rpg` (RPG Maker), `mode-sandbox3d`, `mode-platformer` : chacun a `schema.ts`
  (contrat des fichiers JSON), une logique pure testée, un runtime Pixi/Three chargé par `import()` dynamique
  (le serveur importe les modes : jamais de Pixi/Three/DOM au niveau module), un runtime sans affichage, `templates`,
  `validate`.
- `packages/generators` : `GeneratorDefinition` (`types.ts`) = paramsSchema → spec (IA ou `procedural`) → `render`.
  Registre : `registry.ts`.
- `packages/ai` : client Claude (`llm.ts`), sortie structurée avec validation/relances et critique visuelle
  (`structured.ts`), boucle d'agent à outils (`agent.ts`), `FakeLlmClient` pour les tests.
- `packages/planner` : tâches, jalons, calendrier, outils de l'agent, commandes hors-ligne.
- `apps/server` (Fastify : projets sur disque, jobs de génération, SSE, chat, pilote automatique, export) ;
  `apps/editor` (React 19 + React Spectrum + dockview, lecteur autonome `src/player`).

## Conventions
- TypeScript 7 strict, ESM, `verbatimModuleSyntax` → `import type` pour les types ; pas de `any` nouveau.
- zod v4 : `.default()` prend la valeur de SORTIE ; pour un objet par défaut à compléter, `.prefault({})`.
  Schémas d'outils IA convertis par `z.toJSONSchema(schema, { io: 'input' })` : pas de `.transform`.
- Lignes ≤ 120 caractères. Textes d'interface et commentaires en français ; identifiants en anglais.
- Tests Vitest à côté du code (`*.test.ts`), environnement Node : pas de DOM réel, faux objets minimaux.
- Les contrats partagés (`schema.ts`, `types.ts`, `mode.ts`, `tiles.ts`, `generators/src/types.ts`) ne se modifient
  pas dans une tâche d'implémentation : signaler le besoin.
- Aucun appel réel à l'API Claude dans les tests : `FakeLlmClient`.

## Vérifier
- Un ou plusieurs packages : `node scripts/check.mjs packages/core apps/server` (tsc + vitest + lignes > 120,
  résumé JSON). Tout le dépôt : `pnpm typecheck && pnpm test`.
- Navigateur : `pnpm e2e` (Playwright, Chromium `/opt/pw-browsers/chromium`).

## Travail en parallèle
Plusieurs agents modifient le dépôt en même temps, chacun sur une liste de fichiers autorisés : ne modifier que
ceux-là, ignorer les erreurs transitoires des autres fichiers, ne lancer que ses propres tests, ne pas commiter.
