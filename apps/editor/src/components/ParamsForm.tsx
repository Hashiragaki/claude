import { ColorSwatch, Flex, Item, NumberField, Picker, Switch, TextField } from '@adobe/react-spectrum';
import type { JsonSchema } from '../api';

/** Libellés français des paramètres de générateurs les plus courants. */
const LABELS: Record<string, string> = {
  subject: 'Sujet',
  width: 'Largeur',
  height: 'Hauteur',
  style: 'Style',
  palette: 'Palette (couleurs séparées par des virgules)',
  character: 'Personnage (identité visuelle)',
  expression: 'Expression',
  hairColor: 'Cheveux',
  eyeColor: 'Yeux',
  skinTone: 'Peau',
  outfitColor: 'Tenue',
  hairStyle: 'Coiffure',
  outfitStyle: 'Style de tenue',
  accessory: 'Accessoire',
  scene: 'Lieu',
  timeOfDay: 'Moment de la journée',
  creature: 'Créature',
  color: 'Couleur',
  theme: 'Thème',
  tileSize: 'Taille des tuiles',
  preset: 'Type de son',
  mood: 'Ambiance',
  bpm: 'Tempo (BPM)',
  bars: 'Mesures',
  loop: 'En boucle',
  template: 'Modèle de base',
  animations: 'Animations (séparées par des virgules)',
  frames: 'Images par animation',
  fps: 'Images par seconde',
};

function resolve(schema: JsonSchema): JsonSchema {
  if (schema.anyOf) {
    const concrete = schema.anyOf.find((s) => s.type !== 'null');
    if (concrete) return { ...concrete, description: schema.description ?? concrete.description, default: schema.default };
  }
  return schema;
}

function isColorKey(key: string): boolean {
  return /color|colour|tone/i.test(key);
}

/** Formulaire généré à partir du schéma JSON des paramètres d'un générateur. */
export function ParamsForm(props: {
  schema: JsonSchema;
  values: Record<string, unknown>;
  onChange(values: Record<string, unknown>): void;
  exclude?: string[];
}) {
  const entries = Object.entries(props.schema.properties ?? {}).filter(([k]) => !(props.exclude ?? []).includes(k));
  const set = (key: string, value: unknown) => {
    const next = { ...props.values };
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) delete next[key];
    else next[key] = value;
    props.onChange(next);
  };
  return (
    <Flex direction="column" gap="size-100">
      {entries.map(([key, raw]) => {
        const schema = resolve(raw);
        const label = LABELS[key] ?? key;
        const value = props.values[key];
        const placeholder = schema.default !== undefined ? `Défaut : ${String(schema.default)}` : 'Automatique';
        // `z.literal(x)` est traduit en JSON Schema par `const` (absent du type JsonSchema partagé) :
        // on le traite comme une énumération à une seule valeur, verrouillée en lecture seule.
        const constValue = (schema as JsonSchema & { const?: unknown }).const;
        if (constValue !== undefined) {
          const label2 = String(constValue);
          return (
            <Picker key={key} label={label} selectedKey={label2} isDisabled width="100%">
              <Item key={label2}>{label2}</Item>
            </Picker>
          );
        }
        if (schema.enum) {
          return (
            <Picker
              key={key}
              label={label}
              selectedKey={(value as string | undefined) ?? (schema.default as string | undefined) ?? null}
              onSelectionChange={(k) => set(key, k === '__auto' ? undefined : String(k))}
              width="100%"
            >
              {[
                <Item key="__auto">Automatique</Item>,
                ...schema.enum.map((option) => <Item key={String(option)}>{String(option)}</Item>),
              ]}
            </Picker>
          );
        }
        if (schema.type === 'boolean') {
          return (
            <Switch key={key} isSelected={(value as boolean | undefined) ?? Boolean(schema.default)} onChange={(v) => set(key, v)}>
              {label}
            </Switch>
          );
        }
        if (schema.type === 'number' || schema.type === 'integer') {
          return (
            <NumberField
              key={key}
              label={label}
              value={typeof value === 'number' ? value : NaN}
              onChange={(v) => set(key, Number.isNaN(v) ? undefined : v)}
              minValue={schema.minimum}
              maxValue={schema.maximum}
              step={schema.type === 'integer' ? 1 : 0.1}
              width="100%"
              description={placeholder}
            />
          );
        }
        if (schema.type === 'array') {
          return (
            <TextField
              key={key}
              label={label}
              value={Array.isArray(value) ? value.join(', ') : ''}
              onChange={(v) =>
                set(
                  key,
                  v
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              }
              width="100%"
              placeholder={Array.isArray(schema.default) ? (schema.default as string[]).join(', ') : ''}
            />
          );
        }
        if (schema.type === 'string') {
          return (
            <Flex key={key} gap="size-100" alignItems="end">
              <TextField
                label={label}
                value={(value as string | undefined) ?? ''}
                onChange={(v) => set(key, v)}
                width="100%"
                placeholder={isColorKey(key) ? '#aabbcc' : placeholder}
              />
              {isColorKey(key) && typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value) && (
                <ColorSwatch color={value} size="S" marginBottom="size-50" />
              )}
            </Flex>
          );
        }
        return null;
      })}
    </Flex>
  );
}
