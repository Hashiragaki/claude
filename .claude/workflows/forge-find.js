export const meta = {
  name: 'forge-find',
  description: 'Revue en lecture seule : un chercheur sonnet par zone, trouvailles structurées (à corriger ensuite avec forge-fix)',
  whenToUse:
    'args = { areas: [{ key, focus }], exclude?: string } ; le résultat { findings } se découpe ensuite par groupe de fichiers',
  phases: [{ title: 'Find', detail: 'un chercheur sonnet par zone' }],
}

const CONTEXT = `Dépôt /home/user/claude : lis CLAUDE.md (carte des packages et conventions).
Tu ne modifies AUCUN fichier. Tu peux lire, chercher et lancer des commandes en lecture seule (node scripts/check.mjs <dossier>,
npx vitest run <chemin>, un petit script de reproduction dans /tmp) pour confirmer un soupçon.
${args.exclude ? `Hors périmètre (ne rien signaler) : ${args.exclude}\n` : ''}Ne signale que des défauts RÉELS justifiés par le code : entrée/état concret → mauvais comportement, plantage, faille,
contrat cassé entre packages, course, fuite de ressource, interface qui ne peut pas fonctionner. Pas de style, pas de
« pourrait être amélioré ». Zéro trouvaille est une réponse valide. Chaque trouvaille : fichier (relatif), ligne, titre
d'une ligne, scénario concret, correctif minimal suggéré.`

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          category: { type: 'string' },
          scenario: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['file', 'line', 'title', 'severity', 'category', 'scenario', 'fix'],
      },
    },
  },
  required: ['findings'],
}

const results = await parallel(
  args.areas.map(
    (area) => () =>
      agent(
        `${CONTEXT}\n\nTA ZONE : ${area.focus}\n\nLis tout le code de ta zone (pas un échantillon) et trace chaque soupçon avant de le signaler.`,
        { label: `find:${area.key}`, phase: 'Find', model: 'sonnet', schema: FINDINGS },
      ).then((r) => (r?.findings ?? []).map((f) => ({ ...f, area: area.key }))),
  ),
)
const findings = results.filter(Boolean).flat()
log(`${findings.length} trouvailles`)
return { findings }
