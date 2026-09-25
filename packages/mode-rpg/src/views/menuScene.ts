import { ChoiceMenu } from '@forge/render2d';
import { Container, Graphics, type Text } from 'pixi.js';
import { inventory, isUsableInMenu, useItemOnActor } from '../items';
import { expForLevel } from '../state';
import type { SceneContext } from './context';
import { Panel, choiceMenuHeight, label } from './ui';

export type MenuResult = 'close' | 'title' | 'loaded';

/**
 * Menu principal (ouvert sur la carte) : Objets, Statut, Sauvegarder, Charger, Titre.
 * Fenêtre de commandes à gauche, équipe à droite, or en bas à gauche.
 */
export class MenuScene extends Container {
  private readonly commands: ChoiceMenu;
  private readonly list: ChoiceMenu;
  private readonly targets: ChoiceMenu;
  private readonly partyPanel: Panel;
  private readonly partyText: Text;
  private readonly goldPanel: Panel;
  private readonly goldText: Text;
  private readonly helpPanel: Panel;
  private readonly helpText: Text;
  private readonly detailPanel: Panel;
  private readonly detailText: Text;

  constructor(private readonly ctx: SceneContext) {
    super();
    const { width: w, height: h, theme } = ctx;
    const dim = new Graphics();
    dim.rect(0, 0, w, h).fill({ color: 0x000000, alpha: 0.4 });

    this.partyPanel = new Panel(w - 280, h - 40, theme);
    this.partyPanel.position.set(260, 20);
    this.partyText = label('', theme, { lineHeight: 30 });
    this.partyText.position.set(24, 20);
    this.partyPanel.addChild(this.partyText);

    this.goldPanel = new Panel(220, 56, theme);
    this.goldPanel.position.set(20, h - 76);
    this.goldText = label('', theme);
    this.goldText.position.set(theme.padding, 14);
    this.goldPanel.addChild(this.goldText);

    this.helpPanel = new Panel(w - 280, 60, theme);
    this.helpPanel.position.set(260, 20);
    this.helpText = label('', theme, { wordWrap: true, wordWrapWidth: w - 320 });
    this.helpText.position.set(theme.padding, 16);
    this.helpPanel.addChild(this.helpText);
    this.helpPanel.visible = false;

    this.detailPanel = new Panel(w - 280, h - 40, theme);
    this.detailPanel.position.set(260, 20);
    this.detailText = label('', theme, { lineHeight: 34 });
    this.detailText.position.set(28, 24);
    this.detailPanel.addChild(this.detailText);
    this.detailPanel.visible = false;

    this.commands = new ChoiceMenu(w, h, theme);
    this.list = new ChoiceMenu(w, h, theme);
    this.targets = new ChoiceMenu(w, h, theme);
    this.addChild(dim, this.partyPanel, this.goldPanel, this.helpPanel, this.detailPanel);
    this.addChild(this.commands, this.list, this.targets);
  }

  private t(key: string, params?: Record<string, string | number>): string {
    return this.ctx.i18n.t(key, params);
  }

  private get state() {
    const world = this.ctx.session.world;
    if (!world) throw new Error('Aucune partie en cours');
    return world.state;
  }

  private refresh(): void {
    const t = (k: string) => this.t(k);
    const lines: string[] = [];
    for (const a of this.state.party) {
      lines.push(`${a.name}    ${t('rpg.level')} ${a.level}${a.hp <= 0 ? `    ${t('rpg.ko')}` : ''}`);
      const vitals = `${t('rpg.hp')} ${a.hp}/${a.maxHp}    ${t('rpg.mp')} ${a.mp}/${a.maxMp}`;
      lines.push(`   ${vitals}    ${t('rpg.exp')} ${a.exp}`);
      lines.push('');
    }
    this.partyText.text = lines.join('\n');
    this.goldText.text = `${t('rpg.gold')} : ${this.state.gold}`;
  }

  private help(text: string | null): void {
    this.helpPanel.visible = text !== null;
    this.helpText.text = text ?? '';
  }

  async run(): Promise<MenuResult> {
    const labels = [
      this.t('menu.items'),
      this.t('menu.status'),
      this.t('menu.save'),
      this.t('menu.load'),
      this.t('rpg.titleScreen'),
    ];
    let index = 0;
    for (;;) {
      this.refresh();
      const choice = await this.ctx.choose(
        this.commands,
        labels.map((l) => ({ label: l })),
        { x: 130, y: 20, width: 220, cancelable: true, initialIndex: index, keepOpen: true },
      );
      if (choice < 0) return 'close';
      index = choice;
      switch (choice) {
        case 0:
          await this.itemsScreen();
          break;
        case 1:
          await this.statusScreen();
          break;
        case 2:
          await this.saveScreen();
          break;
        case 3:
          if (await this.loadScreen()) return 'loaded';
          break;
        default:
          if (await this.confirmTitle()) return 'title';
          break;
      }
    }
  }

  private async itemsScreen(): Promise<void> {
    const { session } = this.ctx;
    const database = session.project.database;
    this.partyPanel.visible = false;
    let index = 0;
    for (;;) {
      this.refresh();
      const entries = inventory(this.state, database);
      if (entries.length === 0) {
        this.help(this.t('rpg.noItems'));
        await this.ctx.waitConfirm({ cancel: true });
        break;
      }
      const describe = (i: number) => {
        const item = entries[i]?.item;
        this.help(item ? item.description || (item.key ? this.t('rpg.keyItem') : item.name) : '');
      };
      const pick = await this.ctx.choose(
        this.list,
        entries.map((e) => ({ label: `${e.item.name}   ×${e.count}` })),
        {
          x: 600,
          y: 96,
          width: 560,
          cancelable: true,
          initialIndex: Math.min(index, entries.length - 1),
          keepOpen: true,
          onSelect: describe,
        },
      );
      if (pick < 0) break;
      index = pick;
      const item = entries[pick]?.item;
      if (!item) continue;
      if (!isUsableInMenu(item)) {
        this.help(this.t('rpg.cannotUse'));
        await this.ctx.pause(1);
        continue;
      }
      this.help(this.t('rpg.useOn'));
      const party = this.state.party;
      const hp = this.t('rpg.hp');
      const mp = this.t('rpg.mp');
      const target = await this.ctx.choose(
        this.targets,
        party.map((a) => ({ label: `${a.name}   ${hp} ${a.hp}/${a.maxHp}   ${mp} ${a.mp}/${a.maxMp}` })),
        { x: 600, y: 200, width: 520, cancelable: true },
      );
      if (target < 0) continue;
      const result = useItemOnActor(this.state, database, item.id, target);
      const name = party[target]?.name ?? '';
      if (result.ok) {
        this.ctx.sfx('heal');
        const keys = { heal: 'rpg.recovered', mp: 'rpg.mpRecovered', revive: 'rpg.revived' } as const;
        const key = keys[result.effect.kind];
        this.help(this.t(key, { target: name, value: result.effect.value }));
        session.ctx.events.emit('state-changed', { reason: 'item' });
      } else {
        this.help(this.t('rpg.noEffect'));
      }
      this.refresh();
      await this.ctx.pause(1.2);
    }
    this.list.close();
    this.help(null);
    this.partyPanel.visible = true;
  }

  private async statusScreen(): Promise<void> {
    const party = this.state.party;
    let pick = 0;
    if (party.length > 1) {
      pick = await this.ctx.choose(
        this.targets,
        party.map((a) => ({ label: a.name })),
        { x: 600, y: 120, width: 300, cancelable: true },
      );
      if (pick < 0) return;
    }
    const a = party[pick];
    if (!a) return;
    const database = this.ctx.session.project.database;
    const skills = (database.actors.find((d) => d.id === a.id)?.skills ?? [])
      .map((id) => database.skills.find((s) => s.id === id)?.name ?? id)
      .join(', ');
    const t = (k: string) => this.t(k);
    const toNext = Math.max(0, expForLevel(a.level + 1) - a.exp);
    this.detailText.text = [
      `${a.name}`,
      `${t('rpg.level')} ${a.level}     ${t('rpg.exp')} ${a.exp}     ${t('rpg.nextLevel')} : ${toNext}`,
      `${t('rpg.hp')} ${a.hp}/${a.maxHp}     ${t('rpg.mp')} ${a.mp}/${a.maxMp}`,
      '',
      `${t('rpg.atk')} : ${a.atk}      ${t('rpg.def')} : ${a.def}`,
      `${t('rpg.mag')} : ${a.mag}      ${t('rpg.agi')} : ${a.agi}`,
      '',
      `${t('rpg.skills')} : ${skills || t('rpg.noSkills')}`,
    ].join('\n');
    this.partyPanel.visible = false;
    this.detailPanel.visible = true;
    await this.ctx.waitConfirm({ cancel: true });
    this.detailPanel.visible = false;
    this.partyPanel.visible = true;
  }

  private async saveScreen(): Promise<void> {
    if (!this.state.flags.save) {
      this.help(this.t('rpg.saveDisabled'));
      await this.ctx.pause(1.5);
      this.help(null);
      return;
    }
    const slots = await this.ctx.saveSlots();
    const pick = await this.ctx.choose(
      this.list,
      slots.map((s) => ({ label: s.label })),
      { x: 600, y: 120, width: 640, cancelable: true },
    );
    const slot = slots[pick];
    if (!slot) return;
    const ok = await this.ctx.save(slot.slot);
    this.help(ok ? this.t('save.saved') : this.t('rpg.saveDisabled'));
    await this.ctx.pause(1.2);
    this.help(null);
  }

  private async loadScreen(): Promise<boolean> {
    const slots = await this.ctx.saveSlots();
    const pick = await this.ctx.choose(
      this.list,
      slots.map((s) => ({ label: s.label, enabled: s.exists })),
      { x: 600, y: 120, width: 640, cancelable: true },
    );
    const slot = slots[pick];
    if (!slot) return false;
    if (await this.ctx.load(slot.slot)) return true;
    this.help(this.t('rpg.loadFailed'));
    await this.ctx.pause(1.5);
    this.help(null);
    return false;
  }

  private async confirmTitle(): Promise<boolean> {
    this.help(this.t('rpg.confirmTitle'));
    const pick = await this.ctx.choose(this.targets, [{ label: this.t('rpg.yes') }, { label: this.t('rpg.no') }], {
      x: 600,
      y: this.ctx.height / 2 - choiceMenuHeight(this.ctx.theme, 2) / 2,
      width: 200,
      cancelable: true,
      initialIndex: 1,
    });
    this.help(null);
    return pick === 0;
  }
}
