import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'test-results/screenshots';
mkdirSync(SHOTS, { recursive: true });

async function createProject(page: Page, templateName: string, projectName: string) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Forge' })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(templateName) }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Nom du jeu' }).fill(projectName);
  await dialog.getByRole('button', { name: 'Créer' }).click();
  await expect(page.locator('.fg-topbar')).toContainText(projectName, { timeout: 120_000 });
}

test('visual novel : création, lecture, planning et chat hors-ligne', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.screenshot({ path: `${SHOTS}/01-accueil.png` });
  await createProject(page, 'Le Café des Étoiles', 'Café test');
  await expect(page.locator('.fg-asset-card').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/02-espace-de-travail.png` });

  // Lecture dans l'éditeur.
  await page.getByRole('button', { name: 'Lancer le jeu' }).click();
  const canvas = page.locator('.fg-game-mount canvas');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(1500);
  await canvas.click();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: `${SHOTS}/03-visual-novel.png` });

  // Chat hors-ligne : création d'une tâche.
  const chatInput = page.getByRole('textbox', { name: 'Message' });
  await chatInput.fill('/tache Relire le chapitre 1 !haute ~2h');
  await chatInput.press('Enter');
  await expect(page.locator('.fg-msg.assistant').last()).toContainText('Tâche créée');

  // Planning.
  await page.locator('.dv-tab', { hasText: 'Planning' }).click();
  await expect(page.locator('.fg-card', { hasText: 'Relire le chapitre 1' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/04-planning.png` });
  await page.getByRole('tab', { name: 'Calendrier' }).click();
  await expect(page.locator('svg.fg-gantt')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/05-gantt.png` });

  // Génération procédurale d'un effet sonore.
  const before = await page.locator('.fg-asset-card').count();
  await page.getByRole('button', { name: 'Générer' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Description' }).fill("pièce d'or");
  await dialog.getByRole('button', { name: 'Générer' }).click();
  await expect.poll(async () => page.locator('.fg-asset-card').count(), { timeout: 60_000 }).toBeGreaterThan(before);

  // Éditeur de script.
  await page
    .locator('.fg-rail')
    .getByRole('button', { name: /Script/ })
    .click();
  await expect(page.locator('.cm-editor')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/06-script.png` });

  expect(errors).toEqual([]);
});

test('RPG : création, carte et jeu', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await createProject(page, 'Le Village de Brume', 'Brume test');
  await page.locator('.fg-rail').getByRole('button', { name: 'Éditeur de cartes' }).click();
  await expect(page.locator('.fg-map-canvas-wrap canvas')).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/07-editeur-carte.png` });

  await page.locator('.dv-tab', { hasText: 'Jeu' }).click();
  await page.getByRole('button', { name: 'Lancer le jeu' }).click();
  const canvas = page.locator('.fg-game-mount canvas');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(1500);
  await canvas.click();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  for (const key of ['ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowRight']) {
    await page.keyboard.down(key);
    await page.waitForTimeout(350);
    await page.keyboard.up(key);
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/08-rpg.png` });
  expect(errors).toEqual([]);
});

test('3D : création et jeu', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await createProject(page, 'La Clairière', 'Clairière test');
  await page.getByRole('button', { name: 'Lancer le jeu' }).click();
  const canvas = page.locator('.fg-game-mount canvas');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(2500);
  await canvas.click();
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(900);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/09-sandbox3d.png` });
  expect(errors).toEqual([]);
});
