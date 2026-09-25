import { existsSync } from 'node:fs';
import path from 'node:path';
import { createServer } from './app';
import { REPO_ROOT, loadConfig } from './config';

// Variables d'environnement locales (clé API…) depuis le fichier .env à la racine du dépôt.
const envFile = path.join(REPO_ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const config = loadConfig();
const { app } = await createServer({ config, logger: process.env.FORGE_LOG === 'debug' });

try {
  await app.listen({ port: config.port, host: config.host });
  const ai = config.ai.enabled
    ? `activée (modèle ${config.ai.model ?? 'claude-opus-5'})`
    : 'désactivée — définissez ANTHROPIC_API_KEY pour l\'activer (mode procédural et commandes hors-ligne disponibles)';
  console.log(`\n  Forge — serveur prêt sur http://${config.host}:${config.port}`);
  console.log(`  Projets : ${config.dataDir}`);
  console.log(`  IA : ${ai}\n`);
} catch (error) {
  console.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    // Filet de sécurité : `app.close()` doit déjà être rapide (voir `forceCloseConnections` dans
    // `createServer`), mais on force la sortie plutôt que de laisser le process comme zombie.
    const forceExit = setTimeout(() => process.exit(0), 5000);
    forceExit.unref();
    void app.close().then(() => process.exit(0));
  });
}
