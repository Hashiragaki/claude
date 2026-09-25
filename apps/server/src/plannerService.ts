import { Planner } from '@forge/planner';
import type { EventHub } from './events';
import { Mutex, NotFoundError, type ProjectStore } from './storage';

/** Plans de départ proposés à la création d'un projet, selon le mode. */
const STARTER_PLANS: Record<string, { milestone: string; tasks: { title: string; hours: number; ai?: boolean }[] }> = {
  vn: {
    milestone: 'Prototype jouable',
    tasks: [
      { title: 'Définir le concept, le ton et le public visé', hours: 2 },
      { title: 'Créer les fiches des personnages principaux', hours: 3 },
      { title: 'Écrire le premier chapitre', hours: 6 },
      { title: 'Générer les décors du premier chapitre', hours: 1, ai: true },
      { title: 'Générer les sprites et expressions des personnages', hours: 1, ai: true },
      { title: 'Choisir la musique et les effets sonores', hours: 2 },
      { title: 'Faire tester le prototype à une personne', hours: 1 },
    ],
  },
  rpg: {
    milestone: 'Prototype jouable',
    tasks: [
      { title: "Définir l'univers, la quête principale et les héros", hours: 3 },
      { title: 'Dessiner la carte du premier village', hours: 4 },
      { title: 'Créer les PNJ et leurs dialogues', hours: 3 },
      { title: 'Équilibrer le premier combat et les monstres', hours: 3 },
      { title: 'Générer tilesets, personnages et monstres manquants', hours: 1, ai: true },
      { title: 'Composer les musiques du village et du combat', hours: 1, ai: true },
      { title: 'Faire tester le prototype à une personne', hours: 1 },
    ],
  },
  sandbox3d: {
    milestone: 'Scène de démonstration',
    tasks: [
      { title: "Définir l'ambiance et le style de la scène", hours: 1 },
      { title: 'Générer les modèles 3D principaux', hours: 1, ai: true },
      { title: 'Composer la scène (placement des modèles)', hours: 2 },
      { title: 'Ajouter les animations et tester la navigation', hours: 2 },
    ],
  },
  platformer: {
    milestone: 'Prototype jouable',
    tasks: [
      { title: "Définir l'ambiance, le personnage et la mécanique clé", hours: 2 },
      { title: 'Concevoir le premier niveau (terrain, pièges, arrivée)', hours: 3 },
      { title: 'Placer les pièces, ennemis, ressorts et points de contrôle', hours: 2 },
      { title: 'Générer le tileset, le personnage et les ennemis manquants', hours: 1, ai: true },
      { title: 'Composer la musique et les effets sonores', hours: 1, ai: true },
      { title: 'Faire tester le prototype à une personne', hours: 1 },
    ],
  },
};

/** Planificateurs des projets : chargés à la demande, sauvegardés à chaque modification. */
export class PlannerService {
  private readonly planners = new Map<string, Promise<Planner>>();
  private readonly writers = new Map<string, Mutex>();

  constructor(
    private readonly store: ProjectStore,
    private readonly hub: EventHub,
  ) {}

  get(projectId: string): Promise<Planner> {
    let promise = this.planners.get(projectId);
    if (!promise) {
      promise = this.load(projectId);
      this.planners.set(projectId, promise);
      promise.catch(() => this.planners.delete(projectId));
    }
    return promise;
  }

  private async load(projectId: string): Promise<Planner> {
    if (!(await this.store.exists(projectId))) throw new NotFoundError(`Projet introuvable : ${projectId}`);
    let raw: string | undefined;
    try {
      raw = await this.store.readText(projectId, 'planner.json');
    } catch {
      raw = undefined;
    }
    const planner = await this.parsePlanner(projectId, raw);
    planner.onChange((reason) => {
      // Écriture en tâche de fond : si le projet a été supprimé entre-temps, writeFile échoue
      // (NotFoundError) ; on l'ignore au lieu de laisser une promesse rejetée arrêter le serveur.
      this.save(projectId, planner).catch((error: unknown) => {
        if (!(error instanceof NotFoundError)) console.error(`Sauvegarde du planning ${projectId} :`, error);
      });
      this.hub.publish(projectId, { type: 'planner', data: { reason } });
    });
    return planner;
  }

  /**
   * Construit le planificateur à partir du contenu brut de `planner.json`. Si le fichier existe
   * mais ne respecte plus le schéma (édition manuelle, corruption, ancien format…), le projet
   * doit rester ouvrable : on met le fichier de côté (`planner.invalid.json`), on journalise un
   * avertissement, et on repart d'un planning vide plutôt que de faire échouer le chargement.
   */
  private async parsePlanner(projectId: string, raw: string | undefined): Promise<Planner> {
    if (raw === undefined) return new Planner(undefined);
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return new Planner(undefined);
    }
    try {
      return new Planner(data);
    } catch (error) {
      console.warn(
        `[plannerService] planner.json invalide pour le projet ${projectId}, sauvegardé en ` +
          `planner.invalid.json, planning repris à vide : ${error instanceof Error ? error.message : String(error)}`,
      );
      try {
        await this.store.writeFile(projectId, 'planner.invalid.json', raw, true);
      } catch {
        // La sauvegarde est un best-effort : on n'empêche pas l'ouverture du projet pour ça.
      }
      return new Planner(undefined);
    }
  }

  private save(projectId: string, planner: Planner): Promise<void> {
    let mutex = this.writers.get(projectId);
    if (!mutex) {
      mutex = new Mutex();
      this.writers.set(projectId, mutex);
    }
    return mutex.run(() =>
      this.store.writeFile(projectId, 'planner.json', JSON.stringify(planner.toJSON(), null, 2), true),
    );
  }

  /** Initialise le planning d'un nouveau projet avec un plan de départ. */
  async seed(projectId: string, mode: string): Promise<void> {
    const planner = await this.get(projectId);
    const starter = STARTER_PLANS[mode];
    if (!starter || planner.listTasks().length) return;
    planner.applyPlan(
      {
        milestones: [
          {
            title: starter.milestone,
            tasks: starter.tasks.map((t, i, all) => ({
              title: t.title,
              estimateHours: t.hours,
              assignee: t.ai ? 'ai' : 'user',
              priority: i < 2 ? 'high' : 'medium',
              dependsOnTitles: i === all.length - 1 ? [all[all.length - 2]!.title] : [],
            })),
          },
        ],
      },
      'system',
    );
    await this.flush(projectId);
  }

  /** Attend la fin des écritures en cours. */
  async flush(projectId: string): Promise<void> {
    await this.writers.get(projectId)?.run(async () => undefined);
  }

  forget(projectId: string): void {
    this.planners.delete(projectId);
    this.writers.delete(projectId);
  }
}
