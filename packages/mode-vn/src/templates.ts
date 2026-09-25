import type { ProjectTemplate, TemplateAssetRequest } from '@forge/core';

export const VN_ENTRY = 'scripts/script.vn';

const MANIFEST = { resolution: { width: 1280, height: 720 }, pixelArt: false, entry: VN_ENTRY } as const;

type Scene = 'cafe' | 'street' | 'park' | 'bedroom' | 'classroom' | 'forest' | 'beach' | 'castle' | 'space' | 'generic';
type Expression = 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'embarrassed';

interface CharacterLook {
  character: string;
  hairColor: string;
  eyeColor: string;
  skinTone: string;
  outfitColor: string;
  hairStyle: 'short' | 'long' | 'bob' | 'ponytail' | 'spiky' | 'twintails';
  description: string;
}

const EXPRESSION_FR: Record<Expression, string> = {
  neutral: 'neutre',
  happy: 'joyeuse',
  sad: 'triste',
  angry: 'en colère',
  surprised: 'surprise',
  embarrassed: 'gênée',
};

function background(
  alias: string,
  name: string,
  scene: Scene,
  timeOfDay: 'day' | 'sunset' | 'night',
  prompt: string,
  seed: number,
): TemplateAssetRequest {
  return {
    alias,
    name,
    generator: 'image.svg',
    params: { subject: 'background', scene, timeOfDay, width: 1280, height: 720, prompt },
    seed,
    tags: ['bg'],
  };
}

/** Un sprite par expression ; l'expression neutre porte l'alias nu (`mina`). */
function portraits(tag: string, look: CharacterLook, expressions: Expression[], seed: number): TemplateAssetRequest[] {
  const { description, ...params } = look;
  return expressions.map((expression) => ({
    alias: expression === 'neutral' ? tag : `${tag} ${expression}`,
    name: `${look.character} (${EXPRESSION_FR[expression]})`,
    generator: 'image.svg',
    params: {
      subject: 'portrait',
      ...params,
      expression,
      width: 600,
      height: 900,
      prompt: `${description}, expression ${EXPRESSION_FR[expression]}`,
    },
    seed,
    tags: ['character'],
  }));
}

type Mood = 'calm' | 'happy' | 'tense' | 'sad' | 'epic' | 'mysterious';

function music(alias: string, name: string, mood: Mood, prompt: string, seed: number): TemplateAssetRequest {
  return { alias, name, generator: 'music', params: { mood, bars: 8, prompt }, seed, tags: ['music'] };
}

function sfx(alias: string, name: string, preset: string, prompt: string, seed: number): TemplateAssetRequest {
  return { alias, name, generator: 'sfx', params: { preset, prompt }, seed, tags: ['sfx'] };
}

// ---------------------------------------------------------------------------
// Modèle vide
// ---------------------------------------------------------------------------

export const VN_BLANK_SCRIPT = `# Mon visual novel — script principal
# Chaque « label » est une scène ; le jeu commence au label « start ».

define alice = Character("Alice", color="#f4a261")

label start:
    scene bg parc with fade
    show alice with dissolve
    alice "Bonjour ! Bienvenue dans ton nouveau visual novel."
    "Modifie le fichier scripts/script.vn pour écrire ton histoire."
    return
`;

const ALICE: CharacterLook = {
  character: 'Alice',
  hairColor: '#e0a84f',
  eyeColor: '#4a7c59',
  skinTone: '#f3d2b8',
  outfitColor: '#6a8caf',
  hairStyle: 'long',
  description: 'Alice, jeune femme souriante aux longs cheveux blonds, pull bleu',
};

const blankTemplate: ProjectTemplate = {
  id: 'vn-blank',
  name: 'Visual novel vide',
  description: 'Un script minimal avec un personnage et un décor, prêt à être complété.',
  manifest: { ...MANIFEST, description: 'Un visual novel créé avec Forge.' },
  files: [{ path: VN_ENTRY, content: VN_BLANK_SCRIPT }],
  assets: [
    background('bg parc', 'Décor : parc en journée', 'park', 'day', 'Parc ensoleillé, arbres et banc', 101),
    ...portraits('alice', ALICE, ['neutral'], 102),
  ],
};

// ---------------------------------------------------------------------------
// Démo : Le Café des Étoiles
// ---------------------------------------------------------------------------

export const VN_DEMO_SCRIPT = `# Démo : Le Café des Étoiles
# Un court visual novel pour découvrir le langage de script de Forge (inspiré de Ren'Py).
# Clic ou Entrée : avancer — molette vers le haut : revenir en arrière — Ctrl : passer.

define mina = Character("Mina", color="#f48fb1", image="mina")
define leo = Character("Léo", color="#81c7f5", image="leo")
define moi = Character("[name]", color="#ffe082")

default name = "Sacha"
default affection = 0
default boisson = "rien"

label start:
    scene bg rue with fade
    play music "musique pluie" fadein 2.0
    "Il pleut à verse sur la ville. Au coin de la rue, une enseigne scintille dans la nuit."
    centered "{b}Le Café des Étoiles{/b}"
    "Trempé jusqu'aux os, je pousse la porte."
    play sound "clochette"
    scene bg cafe with dissolve
    play music "musique cafe" fadein 1.5
    show mina happy with dissolve
    mina "Bienvenue au Café des Étoiles ! Installe-toi où tu veux."
    mina "Je m'appelle Mina. Et toi ?"
    moi "Moi, c'est [name]. Joli nom, pour un café."
    mina embarrassed "Merci… C'est ma grand-mère qui l'a choisi."
    mina "Elle disait que les étoiles passent ici les soirs de pluie."

    menu:
        mina "Qu'est-ce que je te sers ?"
        "Un chocolat chaud, s'il te plaît.":
            $ affection += 2
            $ boisson = "chocolat chaud"
            show mina happy
            mina "Excellent choix ! C'est la spécialité de la maison."
        "Juste un verre d'eau.":
            $ affection += 1
            $ boisson = "verre d'eau"
            show mina sad
            mina "Oh… D'accord. L'eau, c'est bien aussi."
        "Surprends-moi !":
            $ affection += 3
            $ boisson = "thé aux étoiles"
            show mina surprised
            mina "Vraiment ? Alors je te prépare mon thé aux étoiles, la recette secrète de ma grand-mère !"

    "Quelques minutes plus tard, Mina m'apporte mon [boisson]."
    call arrivee_leo

    if affection >= 3:
        show mina happy
        mina "Tu sais, [name], c'est rare qu'un client me fasse autant confiance."
    elif affection >= 2:
        show mina neutral
        mina "Reste autant que tu veux, la pluie ne va pas s'arrêter de sitôt."
    else:
        show mina sad
        mina "Tu as l'air pressé… Tu es sûr de ne pas vouloir rester un peu ?"

    menu:
        "La pluie se calme. Que faire ?"
        "Proposer à Mina d'aller voir les étoiles filantes." if affection >= 2:
            jump fin_etoiles
        "Rentrer chez moi avant la prochaine averse.":
            jump fin_pluie

label arrivee_leo:
    play sound "clochette"
    show mina at right
    show leo happy at left with moveinleft
    leo "Bonsoir Mina ! Le ciel va se dégager d'ici une heure, j'en suis sûr."
    mina "Voici Léo. Il est astronome, et il vient ici tous les soirs."
    leo surprised "Oh, un nouveau client ! Tu tombes bien : cette nuit, il y aura une pluie d'étoiles filantes."
    show leo neutral
    leo "Le meilleur endroit pour les admirer, c'est le parc, juste en face. Bonne soirée !"
    hide leo with dissolve
    show mina at center with dissolve
    return

label fin_etoiles:
    show mina embarrassed
    mina "Avec toi ? Je… j'adorerais !"
    scene bg parc with fade
    play music "musique etoiles" fadein 2.0
    show mina happy with dissolve
    "Les nuages se sont dissipés. Assis dans l'herbe encore humide, nous levons les yeux vers le ciel."
    play sound "etoile filante"
    mina "Regarde, [name] ! Fais un vœu, vite !"
    "Je ferme les yeux. Pour une fois, je sais exactement quoi souhaiter."
    centered "Fin : Sous les étoiles"
    return

label fin_pluie:
    show mina sad
    mina "Déjà ? Bon… Reviens quand tu veux, [name]."
    stop music fadeout 1.5
    scene bg rue with fade
    play music "musique pluie" fadein 2.0
    "Je rentre sous la pluie, le col relevé."
    "Plus tard, depuis ma fenêtre, j'aperçois une étoile filante traverser le ciel."
    "La prochaine fois, je resterai peut-être un peu plus longtemps…"
    centered "Fin : Un soir de pluie"
    return
`;

const MINA: CharacterLook = {
  character: 'Mina',
  hairColor: '#f28bb3',
  eyeColor: '#6b4f9e',
  skinTone: '#f5d6c0',
  outfitColor: '#7a4a32',
  hairStyle: 'bob',
  description: 'Mina, jeune serveuse de café aux cheveux roses coupés au carré, tablier marron',
};

const LEO: CharacterLook = {
  character: 'Léo',
  hairColor: '#3b2f2f',
  eyeColor: '#3f7fbf',
  skinTone: '#e3b48f',
  outfitColor: '#2f4f7f',
  hairStyle: 'short',
  description: 'Léo, jeune astronome aux cheveux bruns courts, manteau bleu marine',
};

const RUE_PROMPT = 'Rue de ville la nuit sous la pluie, enseigne de café lumineuse';
const CAFE_PROMPT = 'Café chaleureux et cosy le soir, guirlandes lumineuses, plafond étoilé';
const PARC_PROMPT = 'Parc la nuit, ciel dégagé rempli d\'étoiles filantes';

const demoTemplate: ProjectTemplate = {
  id: 'vn-demo',
  name: 'Démo : Le Café des Étoiles',
  description:
    'Une courte histoire complète : deux personnages, trois décors, expressions, choix conditionnels, '
    + 'variable d\'affection, musique et deux fins.',
  manifest: { ...MANIFEST, description: 'Un soir de pluie, un café mystérieux et une nuit d\'étoiles filantes.' },
  files: [{ path: VN_ENTRY, content: VN_DEMO_SCRIPT }],
  assets: [
    background('bg rue', 'Décor : rue sous la pluie', 'street', 'night', RUE_PROMPT, 201),
    background('bg cafe', 'Décor : Café des Étoiles', 'cafe', 'night', CAFE_PROMPT, 202),
    background('bg parc', 'Décor : parc sous les étoiles', 'park', 'night', PARC_PROMPT, 203),
    ...portraits('mina', MINA, ['neutral', 'happy', 'sad', 'surprised', 'embarrassed'], 210),
    ...portraits('leo', LEO, ['neutral', 'happy', 'surprised'], 220),
    music('musique pluie', 'Musique : soir de pluie', 'sad', 'Piano mélancolique et doux, soirée pluvieuse', 230),
    music('musique cafe', 'Musique : Café des Étoiles', 'calm', 'Ambiance de café chaleureuse et paisible', 231),
    music('musique etoiles', 'Musique : étoiles filantes', 'happy', 'Mélodie féerique sous un ciel étoilé', 232),
    sfx('clochette', 'Son : clochette de porte', 'coin', 'Petite clochette tintant à l\'ouverture d\'une porte', 240),
    sfx('etoile filante', 'Son : étoile filante', 'magic', 'Scintillement magique d\'une étoile filante', 241),
  ],
};

export const VN_TEMPLATES: ProjectTemplate[] = [blankTemplate, demoTemplate];
