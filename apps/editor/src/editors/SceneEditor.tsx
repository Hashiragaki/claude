import {
  ActionButton,
  Button,
  Flex,
  Item,
  NumberField,
  Picker,
  Switch,
  Text,
  TextArea,
  TextField,
} from '@adobe/react-spectrum';
import Add from '@spectrum-icons/workflow/Add';
import Delete from '@spectrum-icons/workflow/Delete';
import Duplicate from '@spectrum-icons/workflow/Duplicate';
import Play from '@spectrum-icons/workflow/Play';
import SaveFloppy from '@spectrum-icons/workflow/SaveFloppy';
import { useEffect, useMemo, useState } from 'react';
import { play, toastError, useApp } from '../state/app';
import { useProjectFile } from './useProjectFile';

type Vec3 = [number, number, number];

interface SceneObject {
  id: string;
  model: string;
  position: Vec3;
  rotation?: Vec3;
  scale?: number | Vec3;
  animation?: string;
  collider?: { radius: number } | false;
  interact?: { text: string; animation?: string; once?: boolean };
}

interface SceneData {
  name?: string;
  timeOfDay?: string;
  sky?: { top: string; bottom: string };
  ground?: { size: number; color: string };
  spawn?: { x: number; z: number; rotation?: number };
  player?: { model?: string; idle?: string; walk?: string; speed?: number; scale?: number };
  music?: string;
  objects: SceneObject[];
  [key: string]: unknown;
}

/** Éditeur de la scène 3D : réglages généraux et liste d'objets (modèles, positions, interactions). */
export function SceneEditor({ path }: { path: string }) {
  const file = useProjectFile(path);
  const project = useApp((s) => s.project);
  const [scene, setScene] = useState<SceneData | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (file.content === null) return;
    try {
      const data = JSON.parse(file.content) as SceneData;
      setScene({ ...data, objects: Array.isArray(data.objects) ? data.objects : [] });
    } catch (error) {
      toastError(error);
    }
  }, [file.content]);

  const models = useMemo(() => (project?.assets ?? []).filter((a) => a.kind === 'model' && a.alias), [project]);
  const music = useMemo(() => (project?.assets ?? []).filter((a) => a.kind === 'music' && a.alias), [project]);
  if (!scene) return <div className="fg-empty">{file.error ?? 'Chargement…'}</div>;

  const update = (patch: Partial<SceneData>) => {
    const next = { ...scene, ...patch };
    setScene(next);
    file.setContent(`${JSON.stringify(next, null, 2)}\n`);
  };
  const updateObject = (id: string, patch: Partial<SceneObject>) =>
    update({ objects: scene.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) });
  const object = scene.objects.find((o) => o.id === selected);
  const uniqueId = (base: string) => {
    let n = 1;
    while (scene.objects.some((o) => o.id === `${base}${n}`)) n++;
    return `${base}${n}`;
  };

  const addObject = () => {
    const model = models[0]?.alias ?? '';
    const id = uniqueId(model.split(' ')[0] || 'objet');
    update({ objects: [...scene.objects, { id, model, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }] });
    setSelected(id);
  };

  return (
    <div className="fg-panel">
      <div className="fg-toolbar">
        <span className="fg-mono" style={{ color: 'var(--fg-text-2)' }}>
          {path}
          {file.dirty ? ' •' : ''}
        </span>
        <ActionButton isQuiet onPress={() => void file.save()} isDisabled={!file.dirty} aria-label="Enregistrer">
          <SaveFloppy />
        </ActionButton>
        <div className="fg-spacer" />
        <Button variant="accent" onPress={() => void file.save().then(() => play({ skipTitle: true }))}>
          <Play />
          <Text>Tester la scène</Text>
        </Button>
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ width: 260, borderRight: '1px solid var(--fg-bg-0)', overflow: 'auto', background: 'var(--fg-bg-1)' }}>
          <Flex margin="size-100" gap="size-100">
            <ActionButton onPress={addObject} isDisabled={models.length === 0}>
              <Add />
              <Text>Objet</Text>
            </ActionButton>
          </Flex>
          <div
            className={`fg-cmd ${selected === null ? 'selected' : ''}`}
            style={{ fontFamily: 'inherit' }}
            role="button"
            tabIndex={0}
            onClick={() => setSelected(null)}
          >
            ⚙ Réglages de la scène
          </div>
          {scene.objects.map((o) => (
            <div
              key={o.id}
              className={`fg-cmd ${selected === o.id ? 'selected' : ''}`}
              style={{ fontFamily: 'inherit' }}
              role="button"
              tabIndex={0}
              onClick={() => setSelected(o.id)}
            >
              {o.interact ? '💬' : '▫'} {o.id} <span style={{ color: 'var(--fg-text-3)' }}>({o.model})</span>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
          {object ? (
            <Flex direction="column" gap="size-100" maxWidth="size-6000">
              <Flex gap="size-100" alignItems="end">
                <TextField label="Identifiant" value={object.id} isReadOnly flex />
                <ActionButton
                  aria-label="Dupliquer"
                  onPress={() => {
                    const id = uniqueId(object.id.replace(/\d+$/, ''));
                    update({ objects: [...scene.objects, { ...structuredClone(object), id, position: [object.position[0] + 2, object.position[1], object.position[2]] }] });
                    setSelected(id);
                  }}
                >
                  <Duplicate />
                </ActionButton>
                <ActionButton
                  aria-label="Supprimer"
                  onPress={() => {
                    update({ objects: scene.objects.filter((o) => o.id !== object.id) });
                    setSelected(null);
                  }}
                >
                  <Delete />
                </ActionButton>
              </Flex>
              <Picker label="Modèle 3D (alias)" selectedKey={object.model} onSelectionChange={(k) => updateObject(object.id, { model: String(k) })} width="100%">
                {models.map((m) => (
                  <Item key={m.alias!}>{`${m.alias} — ${m.name}`}</Item>
                ))}
              </Picker>
              <VecField label="Position (x, y, z)" value={object.position} onChange={(position) => updateObject(object.id, { position })} step={0.5} />
              <VecField label="Rotation (degrés)" value={object.rotation ?? [0, 0, 0]} onChange={(rotation) => updateObject(object.id, { rotation })} step={15} />
              <NumberField
                label="Échelle"
                value={typeof object.scale === 'number' ? object.scale : Array.isArray(object.scale) ? object.scale[0] : 1}
                onChange={(scale) => !Number.isNaN(scale) && updateObject(object.id, { scale })}
                minValue={0.05}
                step={0.1}
                width="size-2000"
              />
              <TextField
                label="Animation en boucle"
                value={object.animation ?? ''}
                onChange={(animation) => updateObject(object.id, { animation: animation || undefined })}
                placeholder="ex. sway, idle"
              />
              <Switch
                isSelected={object.collider !== false}
                onChange={(on) => updateObject(object.id, { collider: on ? { radius: 0.8 } : false })}
              >
                Bloque le joueur (collision)
              </Switch>
              <Switch
                isSelected={Boolean(object.interact)}
                onChange={(on) => updateObject(object.id, { interact: on ? { text: '…' } : undefined })}
              >
                Interaction (texte affiché)
              </Switch>
              {object.interact && (
                <>
                  <TextArea
                    label="Texte de l'interaction"
                    value={object.interact.text}
                    onChange={(text) => updateObject(object.id, { interact: { ...object.interact!, text } })}
                    width="100%"
                  />
                  <TextField
                    label="Animation jouée à l'interaction"
                    value={object.interact.animation ?? ''}
                    onChange={(animation) => updateObject(object.id, { interact: { ...object.interact!, animation: animation || undefined } })}
                    placeholder="ex. open, wave"
                  />
                </>
              )}
            </Flex>
          ) : (
            <Flex direction="column" gap="size-100" maxWidth="size-6000">
              <TextField label="Nom de la scène" value={scene.name ?? ''} onChange={(name) => update({ name })} />
              <Picker label="Moment de la journée" selectedKey={scene.timeOfDay ?? 'day'} onSelectionChange={(k) => update({ timeOfDay: String(k) })}>
                <Item key="day">Jour</Item>
                <Item key="sunset">Coucher de soleil</Item>
                <Item key="night">Nuit</Item>
              </Picker>
              <Flex gap="size-100">
                <TextField label="Ciel (haut)" value={scene.sky?.top ?? ''} onChange={(top) => update({ sky: { top, bottom: scene.sky?.bottom ?? '#ffffff' } })} flex />
                <TextField label="Ciel (horizon)" value={scene.sky?.bottom ?? ''} onChange={(bottom) => update({ sky: { top: scene.sky?.top ?? '#88bbff', bottom } })} flex />
              </Flex>
              <Flex gap="size-100">
                <NumberField label="Taille du sol (m)" value={scene.ground?.size ?? 60} minValue={10} onChange={(size) => update({ ground: { color: scene.ground?.color ?? '#6a9a4a', size } })} flex />
                <TextField label="Couleur du sol" value={scene.ground?.color ?? ''} onChange={(color) => update({ ground: { size: scene.ground?.size ?? 60, color } })} flex />
              </Flex>
              <Picker
                label="Modèle du joueur"
                selectedKey={scene.player?.model ?? 'none'}
                onSelectionChange={(k) => update({ player: { ...(scene.player ?? {}), model: k === 'none' ? undefined : String(k) } })}
              >
                {[<Item key="none">Capsule par défaut</Item>, ...models.map((m) => <Item key={m.alias!}>{m.alias!}</Item>)]}
              </Picker>
              <NumberField
                label="Vitesse du joueur (m/s)"
                value={scene.player?.speed ?? 4}
                minValue={0.5}
                step={0.5}
                onChange={(speed) => update({ player: { ...(scene.player ?? {}), speed } })}
              />
              <Picker label="Musique" selectedKey={scene.music ?? 'none'} onSelectionChange={(k) => update({ music: k === 'none' ? undefined : String(k) })}>
                {[<Item key="none">Aucune</Item>, ...music.map((m) => <Item key={m.alias!}>{m.alias!}</Item>)]}
              </Picker>
              <p style={{ fontSize: 12, color: 'var(--fg-text-3)' }}>
                {scene.objects.length} objets. Générez de nouveaux modèles 3D dans le panneau Assets (donnez-leur un alias) puis
                ajoutez-les à la scène.
              </p>
            </Flex>
          )}
        </div>
      </div>
    </div>
  );
}

function VecField(props: { label: string; value: Vec3; onChange(v: Vec3): void; step: number }) {
  const axes = ['x', 'y', 'z'] as const;
  return (
    <Flex gap="size-100" alignItems="end">
      {axes.map((axis, i) => (
        <NumberField
          key={axis}
          label={i === 0 ? props.label : undefined}
          aria-label={`${props.label} ${axis}`}
          value={props.value[i]}
          step={props.step}
          onChange={(v) => {
            if (Number.isNaN(v)) return;
            const next = [...props.value] as Vec3;
            next[i] = v;
            props.onChange(next);
          }}
          width="size-1200"
        />
      ))}
    </Flex>
  );
}
