/** Qui détient actuellement l'agent IA d'un projet : le chat interactif ou le pilote automatique. */
export type AgentOwner = 'chat' | 'autopilot';

interface Entry {
  owner: AgentOwner;
  controller: AbortController;
}

/** Message 409 renvoyé selon qui détient déjà le verrou. */
const HOLDER_MESSAGES: Record<AgentOwner, string> = {
  chat: 'Une réponse est déjà en cours.',
  autopilot: 'Le pilote automatique travaille sur ce projet.',
};

/**
 * Verrou d'exécution de l'agent IA par projet : le chat et le pilote automatique s'exécutent
 * tous deux via `runAgent`, mais un seul des deux peut travailler à la fois sur un projet donné
 * (ils partagent l'historique de conversation et les outils d'écriture du projet).
 */
export class AgentLock {
  private readonly entries = new Map<string, Entry>();

  /** Détenteur actuel du verrou, ou `null` si le projet est libre. */
  holder(projectId: string): AgentOwner | null {
    return this.entries.get(projectId)?.owner ?? null;
  }

  /** Prend le verrou pour `owner`. Lève une erreur 409 si un autre agent travaille déjà. */
  acquire(projectId: string, owner: AgentOwner): AbortController {
    const current = this.entries.get(projectId);
    if (current) throw Object.assign(new Error(HOLDER_MESSAGES[current.owner]), { statusCode: 409 });
    const controller = new AbortController();
    this.entries.set(projectId, { owner, controller });
    return controller;
  }

  /** Libère le verrou, seulement si `controller` en est bien le détenteur courant. */
  release(projectId: string, controller: AbortController): void {
    const current = this.entries.get(projectId);
    if (current && current.controller === controller) this.entries.delete(projectId);
  }

  /** Annule l'exécution en cours pour ce projet, si le verrou est détenu. */
  abort(projectId: string): boolean {
    const current = this.entries.get(projectId);
    current?.controller.abort();
    return Boolean(current);
  }
}
