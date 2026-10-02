import { ObjectScope, evalExpression, isTruthy, toDisplayString } from '@forge/core';
import type { Value } from '@forge/core';
import { closestPointInWalkArea, distance, findPath, pointInShape, shapeBounds } from './geometry';
import type { Hotspot, Interaction, Point, PointClickAction, PointClickState, Scene, Verb } from './schema';
import type {
  HoverInfo,
  PointClickData,
  PointClickSessionApi,
  PointClickSessionOptions,
  SessionEvent,
  SessionPhase,
  SessionView,
} from './types';

/** Nombre maximal d'actions exécutées d'un trait (garde-fou contre les boucles infinies). */
const MAX_ACTIONS_PER_RUN = 1000;
const DEFAULT_LOOK = 'Rien de spécial.';

interface Frame {
  actions: PointClickAction[];
  index: number;
  /** Chemin structurel stable (sert de clé aux choix `once`). */
  path: string;
}

interface PendingInteraction {
  hotspotId: string;
  item?: string;
}

interface ActiveChoice {
  action: Extract<PointClickAction, { type: 'dialogue' }>;
  path: string;
  /** Index d'origine des choix visibles. */
  visible: number[];
}

type Facing = 'down' | 'left' | 'right' | 'up';

/**
 * Session de jeu point & click : logique pure, sans Pixi ni DOM. Le rendu transmet les clics (en
 * pixels de scène) et lit `view()` / `drainEvents()` à chaque image.
 * Un `goto` abandonne la suite de l'action en cours (le script de la nouvelle scène prend le relais).
 */
export class PointClickSession implements PointClickSessionApi {
  private readonly data: PointClickData;
  private readonly logFn: (level: 'info' | 'warn' | 'error', message: string) => void;
  private readonly initialState?: PointClickState;

  private sceneId: string;
  private player?: Point;
  private facing: Facing = 'down';
  private inventory: string[] = [];
  private vars: Record<string, Value> = {};
  private hotspotVis: Record<string, Record<string, boolean>> = {};
  private visitedScenes = new Set<string>();
  private usedChoices = new Set<string>();
  private currentMusic?: string;

  private phase: SessionPhase = 'explore';
  private selected: string | null = null;
  private stack: Frame[] = [];
  private message?: { text: string; speaker?: string };
  private choice?: ActiveChoice;
  private waitRemaining = 0;
  private endText?: string;
  private path: Point[] = [];
  private pending?: PendingInteraction;
  private events: SessionEvent[] = [];

  constructor(data: PointClickData, options: PointClickSessionOptions = {}) {
    this.data = data;
    this.logFn = options.log ?? (() => undefined);
    this.initialState = options.state;
    this.sceneId = data.system.startScene;
    this.resetNewGame();
  }

  // -------------------------------------------------------------------------
  // Cycle de vie
  // -------------------------------------------------------------------------

  start(): void {
    if (this.initialState) this.applyState(this.initialState);
    this.enterScene(this.sceneId, this.player);
    this.run();
  }

  update(dt: number): void {
    if (dt <= 0) return;
    if (this.phase === 'busy' && this.waitRemaining > 0) {
      this.waitRemaining -= dt;
      if (this.waitRemaining <= 0) {
        this.waitRemaining = 0;
        this.run();
      }
      return;
    }
    if (this.phase !== 'walking' || !this.player) return;
    let budget = this.data.system.walkSpeed * dt;
    while (budget > 0 && this.path.length > 0) {
      const next = this.path[0] as Point;
      const d = distance(this.player, next);
      if (d <= budget) {
        this.face(next.x - this.player.x, next.y - this.player.y);
        this.player = { x: next.x, y: next.y };
        this.path.shift();
        budget -= d;
      } else {
        const k = budget / d;
        this.face(next.x - this.player.x, next.y - this.player.y);
        this.player = {
          x: this.player.x + (next.x - this.player.x) * k,
          y: this.player.y + (next.y - this.player.y) * k,
        };
        budget = 0;
      }
    }
    if (this.path.length === 0) this.arrive();
  }

  // -------------------------------------------------------------------------
  // Entrées du joueur
  // -------------------------------------------------------------------------

  click(point: Point, verb: Verb): void {
    if (!this.canAct()) return;
    const scene = this.scene();
    if (!scene) return;
    const hotspot = this.hotspotAt(scene, point);
    if (verb === 'look') {
      this.stopWalking();
      if (hotspot) this.runInteraction(scene, hotspot, 'look', null);
      return;
    }
    if (!hotspot) {
      this.pending = undefined;
      this.walkTo(scene, point);
      return;
    }
    const pending: PendingInteraction = { hotspotId: hotspot.id };
    if (this.selected) pending.item = this.selected;
    this.stopWalking();
    if (this.hasPlayer(scene)) {
      const target = hotspot.walkTo ?? shapeCenter(hotspot);
      const goal = hotspot.walkTo ? hotspot.walkTo : closestPointInWalkArea(target, scene.walkArea);
      if (goal && this.player && distance(this.player, goal) > 0.5) {
        const route = findPath(this.player, goal, scene.walkArea);
        if (route.length > 0) {
          this.path = route;
          this.pending = pending;
          this.phase = 'walking';
          return;
        }
      }
    }
    this.runPending(pending);
  }

  hover(point: Point): HoverInfo {
    if (!this.canAct()) return { label: '' };
    const scene = this.scene();
    const hotspot = scene ? this.hotspotAt(scene, point) : undefined;
    const item = this.selected ? this.itemName(this.selected) : undefined;
    if (hotspot) {
      const label = item ? `Utiliser ${item} sur ${hotspot.name}` : hotspot.name;
      return { hotspot: { id: hotspot.id, name: hotspot.name, kind: hotspot.kind }, label };
    }
    return { label: item ? `Utiliser ${item} sur…` : '' };
  }

  selectItem(id: string | null): void {
    if (!this.canAct()) return;
    if (id === null || id === this.selected) {
      this.selected = null;
      return;
    }
    if (!this.inventory.includes(id)) {
      this.log('warn', `Objet « ${id} » absent de l'inventaire : sélection ignorée.`);
      return;
    }
    this.selected = id;
  }

  useItemOnItem(target: string): void {
    if (!this.canAct() || !this.selected) return;
    const a = this.selected;
    if (a === target) {
      this.selected = null;
      return;
    }
    if (!this.inventory.includes(target)) {
      this.log('warn', `Objet « ${target} » absent de l'inventaire : combinaison ignorée.`);
      return;
    }
    this.stopWalking();
    this.selected = null;
    const index = this.data.items.combinations.findIndex(
      (c) => ((c.a === a && c.b === target) || (c.a === target && c.b === a)) && this.cond(c.condition),
    );
    const combo = this.data.items.combinations[index];
    if (!combo) {
      this.fail();
      return;
    }
    if (combo.consume) {
      this.removeItem(a);
      this.removeItem(target);
    }
    if (combo.result && !this.inventory.includes(combo.result)) {
      if (this.data.items.items.some((i) => i.id === combo.result)) {
        this.inventory.push(combo.result);
        this.events.push({ type: 'item-gained', item: combo.result });
      } else this.log('warn', `Combinaison : objet résultat « ${combo.result} » inconnu.`);
    }
    const ev: SessionEvent = { type: 'combined', a, b: target };
    if (combo.result) ev.result = combo.result;
    this.events.push(ev);
    this.playSound(this.data.system.sfx.combine);
    this.pushFrame(combo.actions, `combo/${index}`);
    this.run();
  }

  lookItem(id: string): void {
    if (!this.canAct()) return;
    const item = this.data.items.items.find((i) => i.id === id);
    if (!item || !this.inventory.includes(id)) {
      this.log('warn', `Objet « ${id} » introuvable dans l'inventaire.`);
      return;
    }
    this.stopWalking();
    this.say(item.description || DEFAULT_LOOK, item.name);
  }

  advance(): void {
    if (this.phase !== 'message') return;
    this.message = undefined;
    this.run();
  }

  choose(index: number): void {
    const active = this.choice;
    if (this.phase !== 'choice' || !active || !active.visible.includes(index)) return;
    const picked = active.action.choices[index];
    if (!picked) return;
    const key = `${active.path}/${index}`;
    if (picked.once) this.usedChoices.add(key);
    this.choice = undefined;
    this.pushFrame(picked.actions, key);
    this.run();
  }

  // -------------------------------------------------------------------------
  // Lecture
  // -------------------------------------------------------------------------

  view(): SessionView {
    const scene = this.scene();
    const system = this.data.system;
    const view: SessionView = {
      phase: this.phase,
      scene: scene
        ? { id: scene.id, name: scene.name, background: scene.background, width: scene.width, height: scene.height }
        : { id: this.sceneId, name: '', background: '', width: 1280, height: 720 },
      hotspots: [],
      inventory: this.inventory.flatMap((id) => {
        const item = this.data.items.items.find((i) => i.id === id);
        return item ? [{ id, name: item.name, icon: item.icon, description: item.description }] : [];
      }),
    };
    if (scene) {
      for (const h of scene.hotspots) {
        if (!this.isVisible(scene.id, h)) continue;
        const hv: SessionView['hotspots'][number] = {
          id: h.id,
          name: h.name,
          kind: h.kind,
          bounds: shapeBounds(h.shape),
        };
        if (h.sprite) hv.sprite = h.sprite;
        if (h.sprite) hv.spriteAt = h.spriteAt ?? hv.bounds;
        view.hotspots.push(hv);
      }
      if (this.hasPlayer(scene) && this.player) {
        view.player = {
          x: this.player.x,
          y: this.player.y,
          scale: system.playerScale * depthFactor(scene, this.player.y),
          facing: this.facing,
          walking: this.phase === 'walking',
        };
      }
    }
    if (this.selected) view.selectedItem = this.selected;
    if (this.phase === 'message' && this.message) view.message = { ...this.message };
    if (this.phase === 'choice' && this.choice) {
      const { action, visible } = this.choice;
      view.choice = {
        options: visible.map((index) => ({
          index,
          text: this.interp((action.choices[index] as { text: string }).text),
        })),
      };
      if (action.speaker) view.choice.speaker = this.interp(action.speaker);
      if (action.prompt) view.choice.prompt = this.interp(action.prompt);
    }
    if (this.phase === 'ended' && this.endText !== undefined) view.endText = this.endText;
    return view;
  }

  drainEvents(): SessionEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  serialize(): PointClickState {
    const variables: PointClickState['variables'] = {};
    for (const [k, v] of Object.entries(this.vars)) {
      if (v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') variables[k] = v;
    }
    const hotspots: PointClickState['hotspots'] = {};
    for (const [s, m] of Object.entries(this.hotspotVis)) hotspots[s] = { ...m };
    const state: PointClickState = {
      scene: this.sceneId,
      inventory: [...this.inventory],
      variables,
      hotspots,
      visited: [...this.visitedScenes],
      usedChoices: [...this.usedChoices],
    };
    if (this.player) state.player = { x: this.player.x, y: this.player.y };
    return state;
  }

  restore(state: PointClickState): void {
    this.applyState(state);
    this.emitSceneEntry(this.sceneId, undefined);
  }

  debugState(): Record<string, unknown> {
    return {
      scene: this.sceneId,
      phase: this.phase,
      player: this.player ? { ...this.player } : null,
      inventory: [...this.inventory],
      selectedItem: this.selected,
      visited: [...this.visitedScenes],
      variables: { ...this.vars },
    };
  }

  // -------------------------------------------------------------------------
  // État
  // -------------------------------------------------------------------------

  private resetNewGame(): void {
    this.inventory = [];
    for (const id of this.data.system.startItems) {
      if (this.data.items.items.some((i) => i.id === id)) this.inventory.push(id);
      else this.log('warn', `Objet de départ « ${id} » inconnu.`);
    }
    this.vars = {};
    for (const [k, v] of Object.entries(this.data.system.variables)) this.vars[k] = v;
  }

  private applyState(state: PointClickState): void {
    if (!this.data.scenes.has(state.scene)) {
      this.log('error', `Sauvegarde : scène « ${state.scene} » inconnue, état ignoré.`);
      return;
    }
    this.sceneId = state.scene;
    this.player = state.player ? { ...state.player } : undefined;
    this.inventory = state.inventory.filter((id) => this.data.items.items.some((i) => i.id === id));
    this.vars = {};
    for (const [k, v] of Object.entries(state.variables)) this.vars[k] = v;
    this.hotspotVis = {};
    for (const [s, m] of Object.entries(state.hotspots)) this.hotspotVis[s] = { ...m };
    this.visitedScenes = new Set(state.visited);
    this.usedChoices = new Set(state.usedChoices);
    this.resetTransient();
    if (!this.player) this.player = this.defaultPlayerPos(this.scene());
  }

  private resetTransient(): void {
    this.stack = [];
    this.message = undefined;
    this.choice = undefined;
    this.waitRemaining = 0;
    this.endText = undefined;
    this.path = [];
    this.pending = undefined;
    this.selected = null;
    this.phase = 'explore';
  }

  private scene(): Scene | undefined {
    const scene = this.data.scenes.get(this.sceneId);
    if (!scene) this.log('error', `Scène « ${this.sceneId} » inconnue.`);
    return scene;
  }

  private hasPlayer(scene: Scene): boolean {
    return scene.walkArea.length > 0 && !!this.data.system.playerCharset;
  }

  private defaultPlayerPos(scene: Scene | undefined): Point | undefined {
    if (!scene || scene.walkArea.length === 0) return undefined;
    if (scene.playerStart) return { ...scene.playerStart };
    const poly = scene.walkArea[0] as Point[];
    const c = {
      x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
      y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
    };
    return closestPointInWalkArea(c, scene.walkArea);
  }

  private isVisible(sceneId: string, hotspot: Hotspot): boolean {
    const override = this.hotspotVis[sceneId]?.[hotspot.id];
    return override ?? !hotspot.hidden;
  }

  private hotspotAt(scene: Scene, point: Point): Hotspot | undefined {
    for (let i = scene.hotspots.length - 1; i >= 0; i--) {
      const h = scene.hotspots[i] as Hotspot;
      if (this.isVisible(scene.id, h) && pointInShape(point, h.shape)) return h;
    }
    return undefined;
  }

  private canAct(): boolean {
    return this.phase === 'explore' || this.phase === 'walking';
  }

  private itemName(id: string): string {
    return this.data.items.items.find((i) => i.id === id)?.name ?? id;
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.logFn(level, message);
  }

  // -------------------------------------------------------------------------
  // Marche
  // -------------------------------------------------------------------------

  private stopWalking(): void {
    this.path = [];
    this.pending = undefined;
    if (this.phase === 'walking') this.phase = 'explore';
  }

  private walkTo(scene: Scene, point: Point): void {
    if (!this.hasPlayer(scene) || !this.player) return;
    const route = findPath(this.player, point, scene.walkArea);
    if (route.length === 0) {
      this.stopWalking();
      return;
    }
    this.path = route;
    this.phase = 'walking';
  }

  private face(dx: number, dy: number): void {
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return;
    this.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  }

  private arrive(): void {
    this.phase = 'explore';
    const pending = this.pending;
    this.pending = undefined;
    if (pending) this.runPending(pending);
  }

  private runPending(pending: PendingInteraction): void {
    const scene = this.scene();
    const hotspot = scene?.hotspots.find((h) => h.id === pending.hotspotId);
    if (!scene || !hotspot || !this.isVisible(scene.id, hotspot)) return;
    this.runInteraction(scene, hotspot, 'interact', pending.item ?? null);
  }

  // -------------------------------------------------------------------------
  // Interactions
  // -------------------------------------------------------------------------

  private runInteraction(scene: Scene, hotspot: Hotspot, verb: Verb, item: string | null): void {
    const index = hotspot.interactions.findIndex((it: Interaction) => this.matches(it, verb, item));
    const interaction = hotspot.interactions[index];
    if (interaction) {
      if (item) this.selected = null;
      this.pushFrame(interaction.actions, `${scene.id}/${hotspot.id}/${index}`);
      this.run();
      return;
    }
    if (verb === 'look') {
      this.say(hotspot.description ? hotspot.description : DEFAULT_LOOK);
    } else if (item || hotspot.interactions.some((it) => it.verb === 'interact')) {
      this.fail();
    }
  }

  private matches(it: Interaction, verb: Verb, item: string | null): boolean {
    return it.verb === verb && (it.item ?? null) === item && this.cond(it.condition);
  }

  private fail(): void {
    this.events.push({ type: 'fail' });
    this.playSound(this.data.system.sfx.fail);
    this.say(this.data.system.defaultFail);
  }

  /** Affiche une réplique du personnage (hors script). */
  private say(text: string, speaker?: string): void {
    const action: PointClickAction = { type: 'say', text };
    const name = speaker ?? (this.data.system.playerName || undefined);
    if (name) action.speaker = name;
    this.pushFrame([action], 'system');
    this.run();
  }

  private playSound(asset: string | undefined): void {
    if (asset) this.events.push({ type: 'sound', asset });
  }

  // -------------------------------------------------------------------------
  // Interpréteur d'actions
  // -------------------------------------------------------------------------

  private pushFrame(actions: PointClickAction[], path: string): void {
    if (actions.length > 0) this.stack.push({ actions, index: 0, path });
  }

  private run(): void {
    if (this.phase === 'ended') return;
    this.phase = 'busy';
    let count = 0;
    for (;;) {
      const frame = this.stack[this.stack.length - 1];
      if (!frame) {
        this.phase = 'explore';
        return;
      }
      if (frame.index >= frame.actions.length) {
        this.stack.pop();
        continue;
      }
      if (++count > MAX_ACTIONS_PER_RUN) {
        this.log('error', `Plus de ${MAX_ACTIONS_PER_RUN} actions d'affilée : script interrompu (boucle infinie ?).`);
        this.stack = [];
        this.phase = 'explore';
        return;
      }
      const index = frame.index++;
      let blocked = false;
      try {
        blocked = this.exec(frame.actions[index] as PointClickAction, `${frame.path}/${index}`);
      } catch (e) {
        this.log('error', `Erreur pendant l'action ${frame.path}/${index} : ${(e as Error).message}`);
      }
      if (blocked) return;
    }
  }

  /** Exécute une action ; retourne vrai si elle bloque le script (message, choix, pause, fin). */
  private exec(action: PointClickAction, path: string): boolean {
    switch (action.type) {
      case 'say': {
        const m: { text: string; speaker?: string } = { text: this.interp(action.text) };
        if (action.speaker) m.speaker = this.interp(action.speaker);
        this.message = m;
        this.phase = 'message';
        return true;
      }
      case 'give':
        this.giveItem(action.item);
        return false;
      case 'remove':
        this.removeItem(action.item);
        return false;
      case 'set':
        this.setVar(action.var, action.value);
        return false;
      case 'goto':
        this.gotoScene(action);
        return false;
      case 'hide':
      case 'show':
        this.setHotspotVisible(action.hotspot, action.scene, action.type === 'show');
        return false;
      case 'sound':
        this.events.push({ type: 'sound', asset: action.asset });
        return false;
      case 'music':
        this.setMusic(action.asset);
        return false;
      case 'if': {
        const yes = this.cond(action.condition);
        const branch = yes ? action.then : action.else;
        if (branch) this.pushFrame(branch, `${path}/${yes ? 'then' : 'else'}`);
        return false;
      }
      case 'dialogue': {
        const visible: number[] = [];
        action.choices.forEach((c, i) => {
          if (c.once && this.usedChoices.has(`${path}/${i}`)) return;
          if (this.cond(c.condition)) visible.push(i);
        });
        if (visible.length === 0) return false;
        this.choice = { action, path, visible };
        this.phase = 'choice';
        return true;
      }
      case 'wait':
        if (action.seconds <= 0) return false;
        this.waitRemaining = action.seconds;
        this.phase = 'busy';
        return true;
      case 'end':
        this.endText = action.text === undefined ? undefined : this.interp(action.text);
        this.stack = [];
        this.phase = 'ended';
        this.events.push(this.endText === undefined ? { type: 'ended' } : { type: 'ended', text: this.endText });
        return true;
      default:
        return false;
    }
  }

  private giveItem(id: string): void {
    if (!this.data.items.items.some((i) => i.id === id)) {
      this.log('warn', `give : objet « ${id} » inconnu.`);
      return;
    }
    if (this.inventory.includes(id)) return;
    this.inventory.push(id);
    this.events.push({ type: 'item-gained', item: id });
    this.playSound(this.data.system.sfx.pickup);
  }

  private removeItem(id: string): void {
    const i = this.inventory.indexOf(id);
    if (i < 0) {
      this.log('warn', `remove : objet « ${id} » absent de l'inventaire.`);
      return;
    }
    this.inventory.splice(i, 1);
    if (this.selected === id) this.selected = null;
    this.events.push({ type: 'item-lost', item: id });
  }

  private setVar(name: string, expr: string): void {
    try {
      new ObjectScope(this.vars).set(name, this.evaluate(expr));
    } catch (e) {
      this.log('error', `set « ${name} » : ${(e as Error).message}`);
    }
  }

  private setHotspotVisible(hotspotId: string, sceneId: string | undefined, visible: boolean): void {
    const sid = sceneId ?? this.sceneId;
    const scene = this.data.scenes.get(sid);
    if (!scene) {
      this.log('warn', `${visible ? 'show' : 'hide'} : scène « ${sid} » inconnue.`);
      return;
    }
    if (!scene.hotspots.some((h) => h.id === hotspotId)) {
      this.log('warn', `${visible ? 'show' : 'hide'} : zone « ${hotspotId} » inconnue dans « ${sid} ».`);
      return;
    }
    (this.hotspotVis[sid] ??= {})[hotspotId] = visible;
  }

  private setMusic(asset: string | undefined): void {
    if (this.currentMusic === asset) return;
    this.currentMusic = asset;
    this.events.push(asset === undefined ? { type: 'music' } : { type: 'music', asset });
  }

  private gotoScene(action: Extract<PointClickAction, { type: 'goto' }>): void {
    const target = this.data.scenes.get(action.scene);
    if (!target) {
      this.log('error', `goto : scène « ${action.scene} » inconnue.`);
      return;
    }
    const pos = action.x !== undefined && action.y !== undefined ? { x: action.x, y: action.y } : undefined;
    this.enterScene(action.scene, pos, this.sceneId);
  }

  /** Change de scène (si besoin), émet les événements et empile `onFirstEnter` puis `onEnter`. */
  private enterScene(id: string, pos: Point | undefined, previous?: string): void {
    const scene = this.data.scenes.get(id);
    if (!scene) {
      this.log('error', `Scène « ${id} » inconnue.`);
      return;
    }
    const first = !this.visitedScenes.has(id);
    this.sceneId = id;
    this.visitedScenes.add(id);
    this.stack = [];
    this.path = [];
    this.pending = undefined;
    if (this.phase === 'walking') this.phase = 'explore';
    this.player = pos ? { ...pos } : (this.defaultPlayerPos(scene) ?? undefined);
    if (!pos || !this.player) this.facing = 'down';
    this.emitSceneEntry(id, previous);
    this.pushFrame(scene.onEnter, `${id}/onEnter`);
    if (first) this.pushFrame(scene.onFirstEnter, `${id}/onFirstEnter`);
  }

  private emitSceneEntry(id: string, previous: string | undefined): void {
    this.events.push(
      previous === undefined ? { type: 'scene-changed', scene: id } : { type: 'scene-changed', scene: id, previous },
    );
    const music = this.data.scenes.get(id)?.music;
    if (music !== undefined) this.setMusic(music);
  }

  // -------------------------------------------------------------------------
  // Expressions
  // -------------------------------------------------------------------------

  private functions(): Record<string, (...args: Value[]) => Value> {
    return {
      has: (id) => this.inventory.includes(String(id)),
      visited: (id) => this.visitedScenes.has(String(id)),
    };
  }

  private evaluate(source: string): Value {
    return evalExpression(source, new ObjectScope(this.vars), { functions: this.functions() });
  }

  /** Condition absente = vraie ; erreur = faux (journalisée). */
  private cond(source: string | undefined): boolean {
    if (source === undefined) return true;
    try {
      return isTruthy(this.evaluate(source));
    } catch (e) {
      this.log('error', `Condition « ${source} » : ${(e as Error).message}`);
      return false;
    }
  }

  /** Interpolation `{expression}` ; une expression invalide reste telle quelle (journalisée). */
  private interp(text: string): string {
    return text.replace(/\{([^{}]+)\}/g, (whole, expr: string) => {
      try {
        return toDisplayString(this.evaluate(expr));
      } catch (e) {
        this.log('warn', `Interpolation « ${whole} » : ${(e as Error).message}`);
        return whole;
      }
    });
  }
}

function shapeCenter(h: Hotspot): Point {
  const b = shapeBounds(h.shape);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Facteur de profondeur interpolé linéairement et borné aux échelles du haut et du bas. */
function depthFactor(scene: Scene, y: number): number {
  const d = scene.depthScale;
  if (!d) return 1;
  if (d.bottomY === d.topY) return d.topScale;
  const t = Math.max(0, Math.min(1, (y - d.topY) / (d.bottomY - d.topY)));
  return d.topScale + (d.bottomScale - d.topScale) * t;
}
