import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { log, toastError, useApp, validateProject } from '../state/app';

/**
 * Détermine si un fichier doit rester "sale" après l'enregistrement de `savedValue` : vrai si le
 * contenu le plus récent (`latestContent`, capturé au moment où l'écriture se termine) a encore
 * changé depuis, c'est-à-dire si l'utilisateur a tapé pendant la requête d'enregistrement. Évite
 * qu'un enregistrement obsolète n'efface à tort l'indicateur "modifié" d'une frappe plus récente.
 */
export function isDirtyAfterSave(savedValue: string, latestContent: string | null): boolean {
  return latestContent !== null && latestContent !== savedValue;
}

/**
 * Charge un fichier texte du projet, suit les modifications locales et l'enregistre
 * (manuellement ou automatiquement après une pause de frappe).
 */
export function useProjectFile(path: string, options: { autosaveMs?: number } = {}) {
  const projectId = useApp((s) => s.project?.id ?? '');
  const revision = useApp((s) => s.fileRevision[path] ?? 0);
  const [content, setContent] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedRef = useRef<string>('');
  const selfWrites = useRef(0);
  // Toujours à jour, contrairement à `content` capturé dans la fermeture de `save`.
  const latestContentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    // Ignore l'écho de nos propres écritures.
    if (selfWrites.current > 0) {
      selfWrites.current--;
      return;
    }
    let cancelled = false;
    api.readText(projectId, path).then(
      (text) => {
        if (cancelled) return;
        savedRef.current = text;
        latestContentRef.current = text;
        setContent(text);
        setDirty(false);
        setError(null);
      },
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, path, revision]);

  const save = useCallback(
    async (text?: string) => {
      const value = text ?? content;
      if (value === null || !projectId) return;
      try {
        selfWrites.current++;
        await api.writeText(projectId, path, value);
        savedRef.current = value;
        setDirty(isDirtyAfterSave(value, latestContentRef.current));
        log('info', 'éditeur', `${path} enregistré.`);
        void validateProject();
      } catch (e) {
        selfWrites.current = Math.max(0, selfWrites.current - 1);
        toastError(e);
      }
    },
    [content, path, projectId],
  );

  const update = useCallback((text: string) => {
    latestContentRef.current = text;
    setContent(text);
    setDirty(text !== savedRef.current);
  }, []);

  useEffect(() => {
    if (!options.autosaveMs || !dirty || content === null) return;
    const timer = setTimeout(() => void save(content), options.autosaveMs);
    return () => clearTimeout(timer);
  }, [content, dirty, options.autosaveMs, save]);

  return { content, setContent: update, dirty, save, error, projectId };
}
