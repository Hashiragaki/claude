import { TILE } from '@forge/core';
import { MapBuilder } from '../mapBuilder';
import type { Command, RpgMap } from '../schema';

/** Positions clés de la démo (utilisées par les cartes et les tests). */
export const DEMO_POSITIONS = {
  start: { x: 15, y: 20 },
  innDoor: { x: 7, y: 7 },
  elderDoor: { x: 24, y: 6 },
  chest: { x: 13, y: 18 },
  sign: { x: 14, y: 12 },
  villager: { x: 11, y: 9 },
  elder: { x: 22, y: 9 },
  boss: { x: 28, y: 16 },
  innEntry: { x: 6, y: 8 },
  innExit: { x: 6, y: 9 },
  innkeeper: { x: 3, y: 3 },
  innChest: { x: 11, y: 4 },
} as const;

const P = DEMO_POSITIONS;

/** Village principal (32×24) : auberge, maison de l'Ancien, étang et pont, hautes herbes, îlot du boss. */
export function buildVillageMap(): RpgMap {
  const b = new MapBuilder('village', {
    name: 'Village de Brume',
    width: 32,
    height: 24,
    tileset: 'tiles village',
    music: 'musique village',
  });

  // Sol, bordure et chemins
  b.scatter('ground', TILE.ground_alt, 70, 11)
    .border('decor', TILE.bush)
    .path([
      [3, 11],
      [28, 11],
    ])
    .path([
      [7, 8],
      [7, 11],
    ])
    .path([
      [24, 7],
      [24, 11],
    ])
    .path([
      [15, 11],
      [15, 22],
    ])
    .path([
      [15, 16],
      [19, 16],
    ]);

  // Bâtiments : auberge (entrable) et maison de l'Ancien
  b.house(4, 2, 7, 6).house(21, 2, 6, 5);

  // Étang traversé par un pont vers l'îlot clôturé du Roi Slime
  b.pond(20, 14, 6, 5).bridge(20, 16, 6, 1).fence(26, 13, 30, 13).fence(26, 19, 30, 19);

  // Hautes herbes (rencontres) derrière une barrière avec une ouverture
  b.tallGrass(2, 14, 8, 8)
    .fence(2, 13, 5, 13)
    .fence(7, 13, 9, 13)
    .encounters({ troops: ['slimes', 'chauve_souris', 'mixte'], rate: 12, onlyOnRole: 'ground_detail' });

  // Végétation et accessoires
  b.trees([
    [2, 4],
    [12, 4],
    [17, 4],
    [19, 7],
    [29, 5],
    [29, 9],
    [12, 15],
    [18, 20],
    [22, 21],
    [27, 21],
    [11, 21],
  ])
    .scatter('decor', TILE.flowers, 14, 5, { area: { x: 1, y: 8, w: 30, h: 14 } })
    .set('decor', 3, 7, TILE.barrel)
    .set('decor', 11, 7, TILE.crate)
    .set('decor', 20, 6, TILE.barrel)
    .set('decor', 27, 17, TILE.rock)
    .set('decor', 29, 14, TILE.rock);

  // Introduction (exécution automatique, une seule fois)
  b.event({
    id: 'intro',
    name: 'Introduction',
    x: 0,
    y: 0,
    pages: [
      {
        graphic: null,
        trigger: 'autorun',
        priority: 'below',
        commands: [
          { type: 'text', speaker: 'Léa', text: 'Nous voici enfin au village de Brume !' },
          {
            type: 'text',
            speaker: 'Noah',
            text: "L'Ancien du village a demandé de l'aide… Il vit dans la maison au nord-est. Allons le voir !",
          },
          { type: 'moveRoute', target: 'player', steps: ['up'], wait: true },
          { type: 'setSelfSwitch', letter: 'A' },
        ],
      },
      { conditions: { selfSwitch: 'A' }, graphic: null, trigger: 'action', priority: 'below', commands: [] },
    ],
  });

  b.sign(
    'panneau',
    P.sign.x,
    P.sign.y,
    "Village de Brume — Au nord-ouest : l'auberge. Au sud-ouest : les hautes herbes (attention aux monstres !). " +
      "À l'est : l'étang et son pont.",
  );

  const innEntry = { map: 'auberge', x: P.innEntry.x, y: P.innEntry.y, direction: 'up' } as const;
  b.door('porte_auberge', P.innDoor.x, P.innDoor.y, innEntry, { sfx: 'son porte', name: "Porte de l'auberge" });

  b.event({
    id: 'porte_ancien',
    name: "Porte de l'Ancien",
    x: P.elderDoor.x,
    y: P.elderDoor.y,
    pages: [{ graphic: null, commands: [{ type: 'text', text: "Maison de l'Ancien. La porte est fermée à clé." }] }],
  });

  b.chest(
    'coffre',
    P.chest.x,
    P.chest.y,
    [
      { type: 'giveItem', item: 'potion', count: 3 },
      { type: 'text', text: 'Vous trouvez 3 Potions !' },
    ],
    { sfx: 'son piece' },
  );

  b.npc('mila', 'Mila', P.villager.x, P.villager.y, 'chara mila', villagerDialogue(), { movement: 'random', speed: 2 });

  b.npc('ancien', 'Ancien Aldo', P.elder.x, P.elder.y, 'chara ancien', elderQuest(), {
    pages: [
      {
        conditions: { switch: 'quete_roi_slime' },
        graphic: { charset: 'chara ancien', direction: 'down' },
        commands: [
          {
            type: 'text',
            speaker: 'Ancien Aldo',
            text: "Le Roi Slime se cache sur l'îlot, de l'autre côté du pont à l'est. Soyez prudents !",
          },
        ],
      },
      {
        conditions: { switch: 'roi_slime_vaincu' },
        graphic: { charset: 'chara ancien', direction: 'down' },
        commands: elderReward(),
      },
      {
        conditions: { selfSwitch: 'A' },
        graphic: { charset: 'chara ancien', direction: 'down' },
        commands: [
          {
            type: 'text',
            speaker: 'Ancien Aldo',
            text: "Grâce à vous, Brume retrouve sa sérénité. Cette clé ouvre le vieux coffre de l'auberge !",
          },
        ],
      },
    ],
  });

  b.event({
    id: 'roi_slime',
    name: 'Roi Slime',
    x: P.boss.x,
    y: P.boss.y,
    pages: [
      {
        graphic: { charset: 'chara roi slime', direction: 'left' },
        commands: [
          {
            type: 'text',
            text: "Zzz… Une énorme créature gluante fait la sieste. Mieux vaut d'abord parler à l'Ancien.",
          },
        ],
      },
      {
        conditions: { switch: 'quete_roi_slime' },
        graphic: { charset: 'chara roi slime', direction: 'left' },
        commands: [
          { type: 'text', speaker: 'Roi Slime', text: 'Blorp ! Qui ose troubler ma sieste royale ?!' },
          {
            type: 'battle',
            troop: 'roi_slime',
            canEscape: false,
            canLose: false,
            onWin: [
              { type: 'setSwitch', name: 'roi_slime_vaincu' },
              { type: 'setVariable', name: 'quete', op: 'set', value: 2 },
              { type: 'text', text: "Le Roi Slime fond en une petite flaque inoffensive… Retournez voir l'Ancien !" },
            ],
          },
        ],
      },
      { conditions: { switch: 'roi_slime_vaincu' }, graphic: null, priority: 'below', commands: [] },
    ],
  });

  return b.build();
}

function villagerDialogue(): Command[] {
  return [
    { type: 'text', speaker: 'Mila', text: "Bonjour ! Vous êtes nouveaux à Brume, n'est-ce pas ?" },
    {
      type: 'choice',
      options: [
        {
          label: 'Oui, nous arrivons.',
          commands: [
            {
              type: 'text',
              speaker: 'Mila',
              text: "Bienvenue ! L'auberge est au nord-ouest, et l'Ancien habite au nord-est.",
            },
          ],
        },
        {
          label: 'Non, pas du tout.',
          commands: [
            { type: 'text', speaker: 'Mila', text: 'Ah bon ? Je ne vous ai pourtant jamais vus… Bonne journée !' },
          ],
        },
      ],
      cancel: 1,
    },
    { type: 'setVariable', name: 'discussions_mila', op: 'add', value: 1 },
    {
      type: 'text',
      speaker: 'Mila',
      text: 'Des slimes rôdent dans les hautes herbes au sud-ouest. Prudence ! (Discussions : [discussions_mila])',
    },
  ];
}

function elderQuest(): Command[] {
  return [
    {
      type: 'text',
      speaker: 'Ancien Aldo',
      text: "Ah, des voyageurs ! Le Roi Slime s'est installé sur l'îlot à l'est de l'étang…",
    },
    {
      type: 'text',
      speaker: 'Ancien Aldo',
      text: 'Ses sbires envahissent les hautes herbes. Pourriez-vous nous en débarrasser ?',
    },
    {
      type: 'choice',
      options: [
        {
          label: 'Nous acceptons !',
          commands: [
            { type: 'setSwitch', name: 'quete_roi_slime' },
            { type: 'setVariable', name: 'quete', op: 'set', value: 1 },
            {
              type: 'text',
              speaker: 'Ancien Aldo',
              text: "Merci ! Traversez le pont à l'est de l'étang. Reposez-vous à l'auberge avant le combat.",
            },
          ],
        },
        {
          label: 'Pas maintenant.',
          commands: [{ type: 'text', speaker: 'Ancien Aldo', text: 'Revenez me voir quand vous serez prêts.' }],
        },
      ],
      cancel: 1,
    },
  ];
}

function elderReward(): Command[] {
  return [
    { type: 'text', speaker: 'Ancien Aldo', text: 'Vous avez vaincu le Roi Slime ! Tout le village vous remercie.' },
    { type: 'playSfx', ref: 'son piece' },
    { type: 'giveGold', amount: 100 },
    { type: 'giveItem', item: 'cle_coffre', count: 1 },
    { type: 'text', speaker: 'Ancien Aldo', text: "Acceptez ces 100 pièces d'or, ainsi que cette vieille clé." },
    { type: 'setVariable', name: 'quete', op: 'set', value: 3 },
    { type: 'setSelfSwitch', letter: 'A' },
  ];
}

/** Intérieur de l'auberge (13×10) : aubergiste qui soigne contre de l'or, coffre verrouillé. */
export function buildInnMap(): RpgMap {
  const b = new MapBuilder('auberge', {
    name: 'Auberge de Brume',
    width: 13,
    height: 10,
    tileset: 'tiles interieur',
    music: 'musique auberge',
    fill: TILE.void,
  });
  b.room(0, 0, 13, 10, { windows: [2, 8] })
    .set('decor', 5, 1, TILE.torch)
    .set('decor', 7, 1, TILE.torch)
    .set('decor', P.innExit.x, P.innExit.y, TILE.door)
    // Comptoir et étagères
    .set('decor', 1, 2, TILE.shelf)
    .set('decor', 2, 2, TILE.shelf)
    .set('decor', 4, 2, TILE.shelf)
    .set('decor', 5, 2, TILE.shelf)
    .set('decor', 1, 4, TILE.table)
    .set('decor', 2, 4, TILE.table)
    .set('decor', 4, 4, TILE.table)
    .set('decor', 5, 4, TILE.table)
    // Chambres, salle et tapis
    .set('decor', 9, 2, TILE.bed)
    .set('decor', 11, 2, TILE.bed)
    .set('decor', 9, 6, TILE.table)
    .set('decor', 8, 6, TILE.chair)
    .set('decor', 10, 6, TILE.chair)
    .rect('decor', 5, 7, 3, 2, TILE.rug)
    .set('decor', 1, 8, TILE.barrel)
    .set('decor', 11, 8, TILE.barrel);

  const villageEntry = { map: 'village', x: P.innDoor.x, y: P.innDoor.y + 1, direction: 'down' } as const;
  b.door('sortie', P.innExit.x, P.innExit.y, villageEntry, { sfx: 'son porte', name: 'Sortie' });

  b.npc('aubergiste', 'Rosa', P.innkeeper.x, P.innkeeper.y, 'chara aubergiste', [
    {
      type: 'text',
      speaker: 'Rosa',
      text: "Bienvenue à l'auberge de Brume ! Une nuit coûte 10 pièces d'or. (Vous avez [gold] PO.)",
    },
    {
      type: 'choice',
      options: [
        {
          label: 'Se reposer (10 PO)',
          commands: [
            {
              type: 'if',
              condition: { gold: 10 },
              then: [
                { type: 'giveGold', amount: -10 },
                { type: 'wait', seconds: 0.5 },
                { type: 'playSfx', ref: 'son soin' },
                { type: 'healParty' },
                { type: 'setVariable', name: 'nuits_auberge', op: 'add', value: 1 },
                { type: 'text', speaker: 'Rosa', text: "Bonne nuit ! … Toute l'équipe est en pleine forme !" },
              ],
              else: [{ type: 'text', speaker: 'Rosa', text: "Oh… Vous n'avez pas assez d'or, je suis désolée." }],
            },
          ],
        },
        { label: 'Non merci', commands: [{ type: 'text', speaker: 'Rosa', text: 'Revenez quand vous voulez !' }] },
      ],
      cancel: 1,
    },
  ]);

  b.event({
    id: 'coffre_auberge',
    name: 'Coffre verrouillé',
    x: P.innChest.x,
    y: P.innChest.y,
    pages: [
      {
        graphic: { tile: TILE.crate },
        commands: [
          {
            type: 'if',
            condition: { item: 'cle_coffre' },
            then: [
              { type: 'playSfx', ref: 'son piece' },
              { type: 'giveItem', item: 'cle_coffre', count: -1 },
              { type: 'giveItem', item: 'plume_phenix', count: 1 },
              { type: 'giveItem', item: 'ether', count: 2 },
              { type: 'setSelfSwitch', letter: 'A' },
              { type: 'text', text: 'La clé tourne dans la serrure… Vous obtenez une Plume de phénix et 2 Éthers !' },
            ],
            else: [{ type: 'text', text: 'Le coffre est verrouillé. Il faudrait une clé…' }],
          },
        ],
      },
      {
        conditions: { selfSwitch: 'A' },
        graphic: { tile: TILE.crate },
        commands: [{ type: 'text', text: 'Le coffre est vide.' }],
      },
    ],
  });

  return b.build();
}
