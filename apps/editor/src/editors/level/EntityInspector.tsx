import { ActionButton, Flex, Item, NumberField, Picker, TextField, ToggleButton } from '@adobe/react-spectrum';
// Import via chemin relatif : @forge/mode-platformer n'est pas encore une dépendance de
// l'éditeur (le branchement sera fait par un autre agent).
import type { EnemyKind, Facing, PlatformerEntity } from '../../../../../packages/mode-platformer/src/schema';
import Delete from '@spectrum-icons/workflow/Delete';
import { useApp } from '../../state/app';

const TYPE_LABELS: Record<PlatformerEntity['type'], string> = {
  coin: 'Pièce',
  enemy: 'Ennemi',
  spring: 'Ressort',
  checkpoint: 'Point de contrôle',
  goal: 'Arrivée',
  sign: 'Panneau',
};

const ENEMY_KIND_LABELS: Record<EnemyKind, string> = {
  walker: 'Marcheur (patrouille, demi-tour aux bords)',
  hopper: 'Sauteur (petits sauts réguliers)',
};

const FACING_LABELS: Record<Facing, string> = { left: 'Gauche', right: 'Droite' };

/** Propriétés d'une entité de niveau : champs selon le type (kind/speed/facing/range, power, text). */
export function EntityInspector(props: { entity: PlatformerEntity; onChange(entity: PlatformerEntity): void; onDelete(): void }) {
  const { entity } = props;
  const project = useApp((s) => s.project);
  const sprites = (project?.assets ?? []).filter((a) => a.kind === 'charset' && a.alias);

  return (
    <Flex direction="column" gap="size-100">
      <Flex gap="size-100" alignItems="center" justifyContent="space-between">
        <div className="fg-section-title" style={{ margin: 0 }}>
          {TYPE_LABELS[entity.type]}
        </div>
        <ActionButton aria-label="Supprimer l'entité" onPress={props.onDelete}>
          <Delete />
        </ActionButton>
      </Flex>
      <span style={{ fontSize: 11, color: 'var(--fg-text-3)' }}>
        {entity.id} · case ({entity.x}, {entity.y})
      </span>

      {entity.type === 'enemy' && (
        <>
          <Picker
            label="Comportement"
            selectedKey={entity.kind}
            onSelectionChange={(k) => props.onChange({ ...entity, kind: k as EnemyKind })}
            width="size-3000"
          >
            {Object.entries(ENEMY_KIND_LABELS).map(([k, v]) => (
              <Item key={k}>{v}</Item>
            ))}
          </Picker>
          <Flex gap="size-100" wrap>
            <NumberField
              label="Vitesse (px/s)"
              value={entity.speed}
              minValue={1}
              onChange={(speed) => props.onChange({ ...entity, speed })}
              width="size-1600"
            />
            <Picker
              label="Direction de départ"
              selectedKey={entity.facing}
              onSelectionChange={(k) => props.onChange({ ...entity, facing: k as Facing })}
              width="size-1600"
            >
              {Object.entries(FACING_LABELS).map(([k, v]) => (
                <Item key={k}>{v}</Item>
              ))}
            </Picker>
          </Flex>
          <Flex gap="size-100" alignItems="end" wrap>
            <ToggleButton
              isSelected={entity.range !== undefined}
              onChange={(selected) => props.onChange({ ...entity, range: selected ? (entity.range ?? 4) : undefined })}
            >
              Distance de patrouille limitée
            </ToggleButton>
            {entity.range !== undefined && (
              <NumberField
                label="Distance (cases)"
                value={entity.range}
                minValue={1}
                onChange={(range) => props.onChange({ ...entity, range })}
                width="size-1600"
              />
            )}
          </Flex>
          <Picker
            label="Apparence"
            selectedKey={entity.sprite ?? 'none'}
            onSelectionChange={(k) => props.onChange({ ...entity, sprite: k === 'none' ? undefined : String(k) })}
            width="size-3000"
          >
            {[<Item key="none">Forme par défaut</Item>, ...sprites.map((s) => <Item key={s.alias!}>{`🧍 ${s.alias}`}</Item>)]}
          </Picker>
        </>
      )}

      {entity.type === 'spring' && (
        <NumberField
          label="Puissance (px/s)"
          value={entity.power}
          minValue={1}
          onChange={(power) => props.onChange({ ...entity, power })}
          width="size-2000"
        />
      )}

      {entity.type === 'sign' && (
        <TextField label="Texte affiché" value={entity.text} onChange={(text) => props.onChange({ ...entity, text })} width="100%" />
      )}

      {(entity.type === 'coin' || entity.type === 'checkpoint' || entity.type === 'goal') && (
        <p style={{ fontSize: 12, color: 'var(--fg-text-2)', margin: 0 }}>
          {entity.type === 'coin' && 'Ramassée une seule fois par partie.'}
          {entity.type === 'checkpoint' && 'Le joueur y réapparaît après une perte de vie.'}
          {entity.type === 'goal' && 'Termine le niveau quand le joueur l\'atteint.'}
        </p>
      )}
    </Flex>
  );
}
