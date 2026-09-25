export const meta = {
  name: 'forge-fix',
  description:
    'Vérifie puis corrige des trouvailles de revue par groupe de fichiers (correcteur sonnet + vérificateur sonnet)',
  whenToUse:
    'args = { findingsDir, groups: [{ key, files[], notes?, accept? }] } ; trouvailles dans <findingsDir>/findings-<key>.json',
  phases: [
    { title: 'Fix', detail: 'un correcteur par groupe de fichiers : vérifie, test de régression, correctif minimal' },
    { title: 'Verify', detail: 'un vérificateur contradictoire par groupe' },
  ],
};

const SCRATCH = args.findingsDir;

const COMMON = `Dépôt /home/user/claude : suis CLAUDE.md (conventions, travail en parallèle, vérification par scripts/check.mjs).
RÈGLES : ne modifie QUE les « FICHIERS AUTORISÉS » ; aucune dépendance ; aucun commit ; pas de refactor hors du strict nécessaire.`;

const REPORT = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          finding: { type: 'string', description: 'fichier:ligne + titre' },
          verdict: { type: 'string', enum: ['fixed', 'not-a-bug', 'wont-fix'] },
          reason: { type: 'string' },
          test: { type: 'string', description: 'nom du test de régression ajouté, ou vide' },
        },
        required: ['finding', 'verdict', 'reason', 'test'],
      },
    },
    files: { type: 'array', items: { type: 'string' } },
    commands: {
      type: 'array',
      items: {
        type: 'object',
        properties: { cmd: { type: 'string' }, ok: { type: 'boolean' } },
        required: ['cmd', 'ok'],
      },
    },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['items', 'files', 'commands', 'issues'],
};

const VERDICT = {
  type: 'object',
  properties: {
    approved: { type: 'boolean' },
    problems: {
      type: 'array',
      items: { type: 'string' },
      description: 'défauts concrets restants (fichier:ligne + explication)',
    },
  },
  required: ['approved', 'problems'],
};

const results = await pipeline(
  args.groups,
  (g) =>
    agent(
      `${COMMON}

RÔLE : correcteur (forge-implementer).
OBJECTIF : traiter chaque trouvaille de revue du fichier ${SCRATCH}/findings-${g.key}.json (JSON : file, line, title, scenario, fix).
FICHIERS AUTORISÉS : ${g.files.join(', ')}.
${g.notes ? `CONSIGNES PROPRES AU GROUPE : ${g.notes}\n` : ''}ÉTAPES, pour chaque trouvaille :
1) Vérifie qu'elle est réelle en traçant le code (le scénario peut être faux ou déjà couvert ailleurs). Par défaut, si tu n'es pas convaincu : verdict not-a-bug, aucune modification.
2) Si elle est réelle : écris D'ABORD un test de régression qui échoue (dans un fichier de test autorisé), puis le correctif MINIMAL, puis relance le test.
3) Si la correction sort des fichiers autorisés ou change un contrat public : verdict wont-fix, explique ce qu'il faudrait faire.
ACCEPTATION : ${g.accept ?? 'node scripts/check.mjs <dossiers des fichiers autorisés> → RÉSULTAT : OK'}
RAPPORT : objet structuré (un item par trouvaille).`,
      { label: `fix:${g.key}`, phase: 'Fix', model: 'sonnet', schema: REPORT },
    ),
  (report, g) => {
    if (!report) return { group: g.key, report: null, verdict: null };
    return agent(
      `${COMMON}

RÔLE : vérificateur contradictoire (LECTURE SEULE : ne modifie aucun fichier).
Un correcteur a traité les trouvailles de ${SCRATCH}/findings-${g.key}.json dans : ${g.files.join(', ')}.
Examine \`git diff -- ${g.files.join(' ')}\` (et les fichiers de test non suivis avec git status). Cherche : correctif incorrect ou incomplet, régression introduite, test de régression qui ne teste rien (passerait sans le correctif), verdict not-a-bug injustifié, modification hors périmètre. Relance : ${g.accept ?? 'node scripts/check.mjs sur les dossiers concernés'}
Approuve seulement si tout tient ; sinon liste des problèmes concrets.

RAPPORT DU CORRECTEUR :
${JSON.stringify(report, null, 2)}`,
      { label: `verify:${g.key}`, phase: 'Verify', model: 'sonnet', schema: VERDICT },
    ).then((verdict) => ({ group: g.key, report, verdict }));
  },
);

return results.filter(Boolean);
