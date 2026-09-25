import { describe, expect, it, vi } from 'vitest';

// useProjectFile.ts importe '../state/app', qui tire (via @adobe/react-spectrum) des fichiers
// CSS que le pipeline de test ne sait pas charger. On ne teste ici que la fonction pure
// `isDirtyAfterSave`, donc on remplace ce module par des stubs sans effet de bord.
vi.mock('../state/app', () => ({
  log: () => {},
  toastError: () => {},
  useApp: () => undefined,
  validateProject: async () => {},
}));

const { isDirtyAfterSave } = await import('./useProjectFile');

describe('isDirtyAfterSave', () => {
  it("reste sale si le contenu a changé pendant l'enregistrement (édition pendant l'autosave)", () => {
    // save(B) se termine alors que l'utilisateur a déjà tapé C entre-temps : ne doit pas
    // effacer l'indicateur "modifié", sinon le timer d'autosave de C serait annulé et C perdu.
    expect(isDirtyAfterSave('B', 'C')).toBe(true);
  });

  it("redevient propre quand le contenu enregistré est bien le contenu le plus récent", () => {
    expect(isDirtyAfterSave('B', 'B')).toBe(false);
  });

  it('reste propre si aucun contenu n’a encore été chargé', () => {
    expect(isDirtyAfterSave('B', null)).toBe(false);
  });
});
