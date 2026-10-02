import { ItemsFileSchema, PointClickSystemSchema, SceneSchema } from './schema';
import type { ItemsFileInput, Point, PointClickSystemInput, SceneInput } from './schema';
import { PointClickSession } from './session';
import type { PointClickData, PointClickSessionOptions } from './types';

/** Rectangle de marche 0,0 → 1000×500 (sol d'une scène de test). */
export const FLOOR: Point[] = [
  { x: 0, y: 0 },
  { x: 1000, y: 0 },
  { x: 1000, y: 500 },
  { x: 0, y: 500 },
];

export interface MakeDataInput {
  system?: Partial<PointClickSystemInput>;
  items?: ItemsFileInput;
  scenes?: SceneInput[];
}

/** Construit des données valides minimales : une scène `a`, un objet `key`. Chaque champ remplace le défaut. */
export function makeData(input: MakeDataInput = {}): PointClickData {
  const sceneInputs: SceneInput[] = input.scenes ?? [{ id: 'a', background: 'bg-a' }];
  const scenes = new Map(sceneInputs.map((s) => [s.id, SceneSchema.parse(s)] as const));
  const system = PointClickSystemSchema.parse({
    startScene: sceneInputs[0]?.id ?? 'a',
    scenes: sceneInputs.map((s) => s.id),
    ...input.system,
  });
  const items = ItemsFileSchema.parse(
    input.items ?? {
      items: [
        { id: 'key', name: 'Clé', icon: 'icon-key' },
        { id: 'rope', name: 'Corde', icon: 'icon-rope' },
      ],
    },
  );
  return { system, items, scenes };
}

export interface Harness {
  session: PointClickSession;
  logs: string[];
}

/** Crée une session démarrée et un journal des messages. */
export function makeSession(input: MakeDataInput = {}, options: PointClickSessionOptions = {}): Harness {
  const logs: string[] = [];
  const session = new PointClickSession(makeData(input), {
    log: (level, message) => logs.push(`${level}: ${message}`),
    ...options,
  });
  session.start();
  return { session, logs };
}
