import type { ServerResponse } from 'node:http';

/** Événement diffusé aux éditeurs connectés à un projet (Server-Sent Events). */
export interface ProjectEvent {
  type: 'job' | 'asset' | 'manifest' | 'planner' | 'chat' | 'file' | 'autopilot' | 'usage';
  data: unknown;
}

/** Diffusion d'événements par projet vers les clients SSE (et vers des écouteurs internes). */
export class EventHub {
  private readonly clients = new Map<string, Set<ServerResponse>>();
  private readonly listeners = new Set<(projectId: string, event: ProjectEvent) => void>();

  subscribe(projectId: string, res: ServerResponse): () => void {
    let set = this.clients.get(projectId);
    if (!set) {
      set = new Set();
      this.clients.set(projectId, set);
    }
    set.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    return () => {
      clearInterval(ping);
      set.delete(res);
      if (set.size === 0) this.clients.delete(projectId);
    };
  }

  onEvent(listener: (projectId: string, event: ProjectEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(projectId: string, event: ProjectEvent): void {
    for (const l of this.listeners) l(projectId, event);
    const set = this.clients.get(projectId);
    if (!set) return;
    const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
    for (const res of set) res.write(payload);
  }

  clientCount(projectId: string): number {
    return this.clients.get(projectId)?.size ?? 0;
  }
}
