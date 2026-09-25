import { ChoiceMenu } from '@forge/render2d';
import { Container, FillGradient, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import {
  isAliveCombatant,
  type BattleAction,
  type BattleLogEntry,
  type BattleResult,
  type BattlerRef,
  type BattleSystem,
  type Combatant,
} from '../battle';
import { targetsEnemy } from '../items';
import type { SceneContext } from './context';
import { Panel, choiceMenuHeight, colorFromText, label } from './ui';

interface EnemySprite {
  view: Container;
  baseX: number;
  baseY: number;
  height: number;
  blink: number;
}

interface StatusRow {
  highlight: Graphics;
  name: Text;
  level: Text;
  hp: Text;
  mp: Text;
}

const MESSAGE_SECONDS = 0.7;

/**
 * Scène de combat en vue de face : fond, ennemis, fenêtre d'état de l'équipe, commandes,
 * sélection des cibles et animation du journal (dégâts, soins, K.O., messages).
 */
export class BattleScene extends Container {
  private readonly background = new Container();
  private readonly enemyLayer = new Container();
  private readonly fxLayer = new Container();
  private readonly messagePanel: Panel;
  private readonly messageText: Text;
  private readonly statusPanel: Panel;
  private readonly statusRows: StatusRow[] = [];
  private readonly commandMenu: ChoiceMenu;
  private readonly listMenu: ChoiceMenu;
  private readonly targetMenu: ChoiceMenu;
  private readonly targetCursor = new Graphics();
  private enemies: EnemySprite[] = [];
  private activeIndex: number | null = null;
  private shake = 0;
  private time = 0;

  constructor(
    private readonly ctx: SceneContext,
    private readonly battle: BattleSystem,
  ) {
    super();
    const { width: w, height: h, theme } = ctx;
    this.messagePanel = new Panel(w - 40, 60, theme);
    this.messagePanel.position.set(20, 16);
    this.messageText = label('', theme, { wordWrap: true, wordWrapWidth: w - 80 });
    this.messageText.position.set(theme.padding, 16);
    this.messagePanel.addChild(this.messageText);

    const rows = Math.max(1, battle.party.length);
    this.statusPanel = new Panel(w - 320, rows * 34 + 26, theme);
    this.statusPanel.position.set(300, h - this.statusPanel.panelHeight - 16);
    battle.party.forEach((_, i) => this.statusRows.push(this.createStatusRow(i)));

    this.commandMenu = new ChoiceMenu(w, h, theme);
    this.listMenu = new ChoiceMenu(w, h, theme);
    this.targetMenu = new ChoiceMenu(w, h, theme);
    this.targetCursor.poly([-9, -12, 9, -12, 0, 0]).fill(ctx.theme.accentColor).stroke({ width: 2, color: 0x000000 });
    this.targetCursor.visible = false;
    this.addChild(
      this.background,
      this.enemyLayer,
      this.fxLayer,
      this.targetCursor,
      this.messagePanel,
      this.statusPanel,
      this.commandMenu,
      this.listMenu,
      this.targetMenu,
    );
  }

  private t(key: string, params?: Record<string, string | number>): string {
    return this.ctx.i18n.t(key, params);
  }

  private createStatusRow(index: number): StatusRow {
    const y = 13 + index * 34;
    const highlight = new Graphics();
    highlight
      .roundRect(8, y - 2, this.statusPanel.panelWidth - 16, 32, 6)
      .fill({ color: this.ctx.theme.selectionColor, alpha: 0.9 });
    highlight.visible = false;
    const name = label('', this.ctx.theme, { fontWeight: 'bold' });
    const level = label('', this.ctx.theme, { fill: this.ctx.theme.mutedTextColor });
    const hp = label('', this.ctx.theme);
    const mp = label('', this.ctx.theme);
    name.position.set(20, y);
    level.position.set(170, y);
    hp.position.set(270, y);
    mp.position.set(460, y);
    this.statusPanel.addChild(highlight, name, level, hp, mp);
    return { highlight, name, level, hp, mp };
  }

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  async build(): Promise<void> {
    await this.buildBackground();
    await this.buildEnemies();
    this.refreshStatus();
  }

  private async buildBackground(): Promise<void> {
    const { width: w, height: h } = this.ctx;
    const ref = this.ctx.session.project.system.battleback;
    const texture = ref ? await this.ctx.texture(ref, 'image', false) : null;
    if (texture) {
      const sprite = new Sprite(texture);
      const scale = Math.max(w / texture.width, h / texture.height);
      sprite.scale.set(scale);
      sprite.position.set((w - texture.width * scale) / 2, (h - texture.height * scale) / 2);
      this.background.addChild(sprite);
      return;
    }
    const gradient = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      textureSpace: 'local',
      colorStops: [
        { offset: 0, color: 0x101a38 },
        { offset: 0.55, color: 0x2e4d7a },
        { offset: 0.56, color: 0x3d5e33 },
        { offset: 1, color: 0x1f3319 },
      ],
    });
    const g = new Graphics();
    g.rect(0, 0, w, h).fill(gradient);
    g.ellipse(w / 2, h * 0.56, w * 0.42, 46).fill({ color: 0x000000, alpha: 0.18 });
    this.background.addChild(g);
  }

  private async buildEnemies(): Promise<void> {
    const { width: w } = this.ctx;
    const list = this.battle.enemies;
    const n = Math.max(1, list.length);
    const baseline = 300;
    const boxW = Math.min(n === 1 ? 280 : 220, (w - 80) / n - 16);
    const boxH = n === 1 ? 230 : 190;
    const database = this.ctx.session.project.database;
    const textures = await Promise.all(
      list.map((e) => this.ctx.texture(database.enemies.find((d) => d.id === e.id)?.battler, 'image', false)),
    );
    this.enemies = list.map((enemy, i) => {
      const x = (w * (i + 1)) / (n + 1);
      const view = new Container();
      const texture: Texture | null = textures[i] ?? null;
      let height: number;
      if (texture) {
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5, 1);
        const scale = Math.min(boxW / texture.width, boxH / texture.height, 1.5);
        sprite.scale.set(scale);
        view.addChild(sprite);
        height = texture.height * scale;
      } else {
        view.addChild(placeholderBattler(enemy.id, Math.min(boxW, boxH)));
        height = Math.min(boxW, boxH) * 0.8;
      }
      view.position.set(x, baseline);
      this.enemyLayer.addChild(view);
      return { view, baseX: x, baseY: baseline, height, blink: 0 };
    });
  }

  // -------------------------------------------------------------------------
  // Affichage
  // -------------------------------------------------------------------------

  private setMessage(text: string): void {
    this.messageText.text = text;
  }

  private refreshStatus(): void {
    const t = (k: string) => this.t(k);
    this.battle.party.forEach((member, i) => {
      const row = this.statusRows[i];
      if (!row) return;
      const s = member.stats;
      const ko = s.hp <= 0;
      row.name.text = member.name;
      row.name.style.fill = ko ? 0xff6b6b : this.ctx.theme.textColor;
      const actor = this.ctx.session.world?.state.party[i];
      row.level.text = `${t('rpg.level')} ${actor?.level ?? 1}`;
      row.hp.text = ko ? `${t('rpg.hp')} 0/${s.maxHp}  ${t('rpg.ko')}` : `${t('rpg.hp')} ${s.hp}/${s.maxHp}`;
      row.hp.style.fill = ko ? 0xff6b6b : s.hp < s.maxHp / 4 ? 0xffc04d : this.ctx.theme.textColor;
      row.mp.text = `${t('rpg.mp')} ${s.mp}/${s.maxMp}`;
      row.highlight.visible = this.activeIndex === i;
    });
  }

  private positionOf(ref: BattlerRef): { x: number; y: number } {
    if (ref.side === 'enemy') {
      const e = this.enemies[ref.index];
      return e ? { x: e.baseX, y: e.baseY - e.height * 0.6 } : { x: this.ctx.width / 2, y: 200 };
    }
    return { x: this.statusPanel.x + 330, y: this.statusPanel.y + 13 + ref.index * 34 };
  }

  private popNumber(ref: BattlerRef, value: number, color: number): void {
    const { x, y } = this.positionOf(ref);
    const text = new Text({
      text: String(value),
      style: {
        fontFamily: this.ctx.theme.fontFamily,
        fontSize: 32,
        fontWeight: 'bold',
        fill: color,
        stroke: { color: 0x000000, width: 5 },
      },
    });
    text.anchor.set(0.5);
    text.position.set(x, y);
    this.fxLayer.addChild(text);
    void this.ctx.tweens.to(text, { y: y - 40 }, 0.5, { easing: 'easeOutCubic' });
    void this.ctx.tweens.to(text, { alpha: 0 }, 0.4, { delay: 0.6 }).then(() => text.destroy());
  }

  private pointCursor(enemyIndex: number | null): void {
    const e = enemyIndex === null ? undefined : this.enemies[enemyIndex];
    this.targetCursor.visible = !!e;
    if (e) this.targetCursor.position.set(e.baseX, e.baseY - e.height - 8);
  }

  update(dt: number): void {
    this.time += dt;
    for (const e of this.enemies) {
      if (e.blink > 0) {
        e.blink -= dt;
        e.view.visible = e.blink <= 0 || Math.floor(e.blink * 24) % 2 === 0;
      }
    }
    if (this.shake > 0) {
      this.shake -= dt;
      this.x = this.shake > 0 ? Math.round((Math.random() * 2 - 1) * 6) : 0;
    }
    if (this.targetCursor.visible) this.targetCursor.pivot.y = Math.sin(this.time * 8) * 3;
  }

  // -------------------------------------------------------------------------
  // Déroulement
  // -------------------------------------------------------------------------

  /** Joue le combat jusqu'à son issue. */
  async run(): Promise<BattleResult> {
    await this.playLog(this.battle.start());
    while (this.battle.phase === 'input') {
      const decision = await this.inputPhase();
      this.setMessage('');
      const log = decision === 'escape' ? this.battle.escape() : this.battle.executeTurn();
      await this.playLog(log);
    }
    await this.ctx.waitConfirm({ cancel: true });
    return this.battle.result ?? 'escape';
  }

  private async inputPhase(): Promise<'turn' | 'escape'> {
    const first = this.battle.nextInputIndex();
    let index = first;
    while (index !== null) {
      const member = this.battle.party[index] as Combatant;
      this.activeIndex = index;
      this.refreshStatus();
      this.setMessage(this.t('battle.commandFor', { name: member.name }));
      const commands = [
        { label: this.t('battle.attack') },
        { label: this.t('battle.skill'), enabled: member.skills.length > 0 },
        { label: this.t('battle.item'), enabled: this.battle.battleItems().length > 0 },
        { label: this.t('battle.guard') },
        { label: this.t('battle.escape'), enabled: this.battle.canEscape },
      ];
      const menuH = choiceMenuHeight(this.ctx.theme, commands.length);
      const choice = await this.ctx.choose(this.commandMenu, commands, {
        x: 150,
        y: this.ctx.height - menuH - 16,
        width: 250,
        cancelable: index !== first,
      });
      if (choice < 0) {
        const prev = this.battle.previousInputIndex(index);
        if (prev !== null) {
          this.battle.clearCommand(prev);
          index = prev;
        }
        continue;
      }
      const action = await this.actionFor(choice, index);
      if (action === 'escape') {
        this.activeIndex = null;
        this.refreshStatus();
        return 'escape';
      }
      if (!action) continue;
      this.battle.setCommand(index, action);
      index = this.battle.nextInputIndex(index);
    }
    this.activeIndex = null;
    this.refreshStatus();
    return 'turn';
  }

  private async actionFor(choice: number, index: number): Promise<BattleAction | 'escape' | null> {
    switch (choice) {
      case 0: {
        const target = await this.chooseEnemy();
        return target === null ? null : { kind: 'attack', target };
      }
      case 1:
        return this.chooseSkill(index);
      case 2:
        return this.chooseItem();
      case 3:
        return { kind: 'guard' };
      default:
        return 'escape';
    }
  }

  private async chooseSkill(index: number): Promise<BattleAction | null> {
    const skills = this.battle.skillsOf(index);
    const mp = this.t('rpg.mp');
    const pick = await this.ctx.choose(
      this.listMenu,
      skills.map((s) => ({ label: `${s.skill.name}   ${s.skill.mpCost} ${mp}`, enabled: s.usable })),
      {
        x: this.ctx.width / 2,
        y: 90,
        width: 460,
        cancelable: true,
        onSelect: (i) => this.setMessage(skills[i]?.skill.description ?? ''),
      },
    );
    const skill = skills[pick]?.skill;
    if (!skill) return null;
    if (skill.target === 'enemy') {
      const target = await this.chooseEnemy();
      return target === null ? null : { kind: 'skill', skill: skill.id, target };
    }
    if (skill.target === 'ally') {
      const target = await this.chooseAlly(false);
      return target === null ? null : { kind: 'skill', skill: skill.id, target };
    }
    return { kind: 'skill', skill: skill.id };
  }

  private async chooseItem(): Promise<BattleAction | null> {
    const items = this.battle.battleItems();
    const pick = await this.ctx.choose(
      this.listMenu,
      items.map((i) => ({ label: `${i.item.name}   ×${i.count}` })),
      {
        x: this.ctx.width / 2,
        y: 90,
        width: 460,
        cancelable: true,
        onSelect: (i) => this.setMessage(items[i]?.item.description ?? ''),
      },
    );
    const item = items[pick]?.item;
    if (!item) return null;
    const target = targetsEnemy(item) ? await this.chooseEnemy() : await this.chooseAlly(item.effect.type === 'revive');
    return target === null ? null : { kind: 'item', item: item.id, target };
  }

  private async chooseEnemy(): Promise<number | null> {
    const alive = this.battle.enemies.filter(isAliveCombatant);
    if (alive.length <= 1) return alive[0]?.index ?? null;
    this.setMessage(this.t('battle.chooseTarget'));
    const menuH = choiceMenuHeight(this.ctx.theme, alive.length);
    const pick = await this.ctx.choose(
      this.targetMenu,
      alive.map((e) => ({ label: e.name })),
      {
        x: 150,
        y: this.ctx.height - menuH - 16,
        width: 250,
        cancelable: true,
        onSelect: (i) => this.pointCursor(alive[i]?.index ?? null),
      },
    );
    this.pointCursor(null);
    return pick < 0 ? null : (alive[pick]?.index ?? null);
  }

  private async chooseAlly(dead: boolean): Promise<number | null> {
    const party = this.battle.party;
    if (party.length === 1) return (party[0]?.stats.hp ?? 0) > 0 === !dead ? 0 : null;
    this.setMessage(this.t('battle.chooseTarget'));
    const hp = this.t('rpg.hp');
    const menuH = choiceMenuHeight(this.ctx.theme, party.length);
    const pick = await this.ctx.choose(
      this.targetMenu,
      party.map((m) => ({
        label: `${m.name}  ${hp} ${m.stats.hp}/${m.stats.maxHp}`,
        enabled: dead ? m.stats.hp <= 0 : m.stats.hp > 0,
      })),
      { x: 150, y: this.ctx.height - menuH - 16, width: 270, cancelable: true },
    );
    return pick < 0 ? null : pick;
  }

  /** Anime le journal d'un tour, entrée par entrée. */
  private async playLog(log: BattleLogEntry[]): Promise<void> {
    const { session } = this.ctx;
    for (const entry of log) {
      switch (entry.type) {
        case 'message':
          if (entry.key === 'battle.victory') {
            const music = session.project.system.victoryMusic;
            if (music) session.playMusic(music, { loop: false });
          }
          this.setMessage(entry.text);
          await this.ctx.pause(MESSAGE_SECONDS);
          break;
        case 'action':
          if (entry.actor.side === 'enemy') {
            const e = this.enemies[entry.actor.index];
            if (e) e.blink = 0.25;
          } else {
            this.activeIndex = entry.actor.index;
            this.refreshStatus();
          }
          if (entry.sfx) session.playSfx(entry.sfx);
          break;
        case 'damage':
          this.ctx.sfx('hit');
          if (entry.target.side === 'enemy') {
            const e = this.enemies[entry.target.index];
            if (e) e.blink = 0.4;
          } else {
            this.shake = 0.3;
          }
          this.popNumber(entry.target, entry.value, 0xffffff);
          this.refreshStatus();
          await this.ctx.flow.delay(0.2);
          break;
        case 'heal':
          this.ctx.sfx('heal');
          this.popNumber(entry.target, entry.value, 0x7dff9a);
          this.refreshStatus();
          break;
        case 'mp':
          if (entry.value > 0) this.popNumber(entry.target, entry.value, 0x8ac8ff);
          this.refreshStatus();
          break;
        case 'revive':
          this.ctx.sfx('heal');
          this.refreshStatus();
          break;
        case 'defeated':
          if (entry.target.side === 'enemy') {
            const e = this.enemies[entry.target.index];
            if (e) {
              e.blink = 0;
              e.view.visible = true;
              void this.ctx.tweens.to(e.view, { alpha: 0 }, 0.45);
            }
          }
          this.refreshStatus();
          break;
        case 'levelUp':
          this.refreshStatus();
          break;
        case 'end':
          this.activeIndex = null;
          this.refreshStatus();
          break;
      }
    }
    this.activeIndex = null;
    this.refreshStatus();
  }
}

/** Silhouette d'ennemi de remplacement (image manquante). */
function placeholderBattler(id: string, size: number): Graphics {
  const g = new Graphics();
  const color = colorFromText(id);
  g.ellipse(0, -2, size * 0.42, size * 0.08).fill({ color: 0x000000, alpha: 0.3 });
  g.ellipse(0, -size * 0.35, size * 0.4, size * 0.35).fill(color).stroke({ width: 3, color: 0x000000, alpha: 0.4 });
  g.circle(-size * 0.13, -size * 0.42, size * 0.06).fill(0xffffff);
  g.circle(size * 0.13, -size * 0.42, size * 0.06).fill(0xffffff);
  g.circle(-size * 0.13, -size * 0.42, size * 0.03).fill(0x000000);
  g.circle(size * 0.13, -size * 0.42, size * 0.03).fill(0x000000);
  return g;
}
