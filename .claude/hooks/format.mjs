#!/usr/bin/env node
// Hook PostToolUse (Edit/Write/MultiEdit) : formate avec Prettier le fichier que l'agent vient d'écrire.
// Ne bloque jamais l'agent : toute erreur est ignorée (le contrôle final reste `node scripts/check.mjs`).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const file = input?.tool_input?.file_path;
  if (typeof file === 'string' && /\.(ts|tsx|mjs|css)$/.test(file) && !file.includes('node_modules')) {
    spawnSync('npx', ['prettier', '--write', '--log-level', 'silent', file], {
      cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
      stdio: 'ignore',
      timeout: 20_000,
    });
  }
} catch {
  // entrée inattendue : rien à faire
}
