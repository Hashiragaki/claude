import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

// Chromium préinstallé (environnements cloud) ; sinon Playwright utilise son propre navigateur.
const chromium =
  process.env.FORGE_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const dataDir = path.resolve('test-results/e2e-workspace');
rmSync(dataDir, { recursive: true, force: true });

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  outputDir: 'test-results/e2e',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1600, height: 960 },
    screenshot: 'only-on-failure',
    launchOptions: chromium ? { executablePath: chromium } : {},
  },
  webServer: [
    {
      command: 'pnpm --filter @forge/server start',
      url: 'http://127.0.0.1:8787/api/health',
      env: { FORGE_DATA_DIR: dataDir, FORGE_AI: 'off', PORT: '8787' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @forge/editor exec vite --host 127.0.0.1 --port 5173 --strictPort',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
