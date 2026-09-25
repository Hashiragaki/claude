import {
  ActionButton,
  AlertDialog,
  Button,
  ButtonGroup,
  Content,
  Dialog,
  DialogContainer,
  Divider,
  Form,
  Heading,
  Item,
  Picker,
  ProgressCircle,
  Text,
  TextField,
} from '@adobe/react-spectrum';
import Add from '@spectrum-icons/workflow/Add';
import Delete from '@spectrum-icons/workflow/Delete';
import { useState } from 'react';
import { useT } from '../i18n';
import { createProject, deleteProject, openProject, toastError, useApp } from '../state/app';

const MODE_ART: Record<string, { gradient: string; label: string }> = {
  vn: { gradient: 'linear-gradient(135deg, #c2458b 0%, #6a3db8 100%)', label: 'Visual Novel' },
  rpg: { gradient: 'linear-gradient(135deg, #2f9e5e 0%, #1f6e9e 100%)', label: 'RPG' },
  sandbox3d: { gradient: 'linear-gradient(135deg, #e0782f 0%, #b8403d 100%)', label: '3D' },
};

export function modeBadge(mode: string) {
  return <span className={`fg-mode-badge fg-mode-${mode}`}>{MODE_ART[mode]?.label ?? mode}</span>;
}

/** Écran d'accueil : projets récents et création à partir des modèles. */
export function Home() {
  const t = useT();
  const modes = useApp((s) => s.modes);
  const projects = useApp((s) => s.projects);
  const health = useApp((s) => s.health);
  const [creating, setCreating] = useState<{ mode: string; template: string } | null>(null);
  const [toDelete, setToDelete] = useState<{ id: string; name: string } | null>(null);

  return (
    <div className="fg-home">
      <div className="fg-home-inner">
        <div className="fg-hero">
          <div className="fg-appicon">Fg</div>
          <div>
            <h1>Forge</h1>
            <p>
              Créez des jeux avec l'aide de l'IA : visual novels, RPG et scènes 3D, assets générés, planning suivi par
              un assistant.
            </p>
          </div>
          <div className="fg-spacer" />
          <Button variant="accent" onPress={() => setCreating({ mode: modes[0]?.id ?? 'vn', template: '' })}>
            <Add />
            <Text>{t('home.new')}</Text>
          </Button>
        </div>

        {!health?.ai.enabled && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 6,
              background: '#2d2a1f',
              color: '#e9d7a5',
              fontSize: 13,
              marginBottom: 24,
            }}
          >
            IA hors-ligne : la génération utilise les algorithmes procéduraux et l'assistant comprend les commandes
            <code> /tache</code>, <code>/revue</code>… Définissez <code>ANTHROPIC_API_KEY</code> avant de lancer le
            serveur pour activer Claude.
          </div>
        )}

        <div className="fg-section-title" style={{ margin: '0 0 10px' }}>
          {t('home.templates')}
        </div>
        <div className="fg-cards">
          {modes.flatMap((mode) =>
            mode.templates.map((template) => (
              <button
                key={`${mode.id}:${template.id}`}
                className="fg-template"
                onClick={() => setCreating({ mode: mode.id, template: template.id })}
              >
                <div className="fg-template-art" style={{ background: MODE_ART[mode.id]?.gradient ?? '#444' }}>
                  {mode.name}
                </div>
                <div className="fg-template-body">
                  <h3>{template.name}</h3>
                  <p>{template.description}</p>
                </div>
              </button>
            )),
          )}
        </div>

        <div className="fg-section-title" style={{ margin: '32px 0 10px' }}>
          {t('home.recent')}
        </div>
        {projects.length === 0 ? (
          <p style={{ color: 'var(--fg-text-3)', fontSize: 13 }}>{t('home.empty')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {projects.map((p) => (
              <div
                key={p.id}
                className="fg-project-row"
                role="button"
                tabIndex={0}
                onClick={() => void openProject(p.id).catch(toastError)}
                onKeyDown={(e) => e.key === 'Enter' && void openProject(p.id).catch(toastError)}
              >
                {modeBadge(p.mode)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--fg-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.description || '—'}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--fg-text-3)' }}>
                  {p.assetCount} assets · modifié le {new Date(p.updatedAt).toLocaleDateString('fr-FR')}
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <ActionButton isQuiet aria-label="Supprimer" onPress={() => setToDelete({ id: p.id, name: p.name })}>
                    <Delete />
                  </ActionButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <DialogContainer onDismiss={() => setCreating(null)}>
        {creating && (
          <NewProjectDialog
            initialMode={creating.mode}
            initialTemplate={creating.template}
            onClose={() => setCreating(null)}
          />
        )}
      </DialogContainer>
      <DialogContainer onDismiss={() => setToDelete(null)}>
        {toDelete && (
          <AlertDialog
            title="Supprimer le projet ?"
            variant="destructive"
            primaryActionLabel="Supprimer"
            cancelLabel="Annuler"
            onPrimaryAction={() => void deleteProject(toDelete.id).catch(toastError)}
          >
            « {toDelete.name} » et tous ses fichiers seront supprimés définitivement.
          </AlertDialog>
        )}
      </DialogContainer>
    </div>
  );
}

export function NewProjectDialog(props: { initialMode?: string; initialTemplate?: string; onClose(): void }) {
  const modes = useApp((s) => s.modes);
  const [mode, setMode] = useState(props.initialMode ?? modes[0]?.id ?? 'vn');
  const current = modes.find((m) => m.id === mode);
  const [template, setTemplate] = useState(
    props.initialTemplate || current?.templates.find((t) => t.id.endsWith('demo'))?.id || current?.templates[0]?.id || '',
  );
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const templates = current?.templates ?? [];
  const selectedTemplate = templates.find((t) => t.id === template) ?? templates[0];

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createProject({ name: name.trim(), mode, template: selectedTemplate?.id });
      props.onClose();
    } catch (error) {
      toastError(error);
      setBusy(false);
    }
  };

  return (
    <Dialog size="M">
      <Heading>Nouveau projet</Heading>
      <Divider />
      <Content>
        <Form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <TextField label="Nom du jeu" value={name} onChange={setName} autoFocus isRequired />
          <Picker
            label="Mode de jeu"
            selectedKey={mode}
            onSelectionChange={(key) => {
              const next = String(key);
              setMode(next);
              const m = modes.find((x) => x.id === next);
              setTemplate(m?.templates.find((t) => t.id.endsWith('demo'))?.id ?? m?.templates[0]?.id ?? '');
            }}
          >
            {modes.map((m) => (
              <Item key={m.id}>{m.name}</Item>
            ))}
          </Picker>
          <Picker label="Modèle" selectedKey={selectedTemplate?.id ?? null} onSelectionChange={(k) => setTemplate(String(k))}>
            {templates.map((t) => (
              <Item key={t.id}>{t.name}</Item>
            ))}
          </Picker>
          <Text>
            <span style={{ fontSize: 12, color: 'var(--fg-text-2)' }}>
              {selectedTemplate?.description ?? current?.description}
            </span>
          </Text>
        </Form>
      </Content>
      <ButtonGroup>
        {busy && <ProgressCircle aria-label="Création" isIndeterminate size="S" marginEnd="size-150" />}
        <Button variant="secondary" onPress={props.onClose} isDisabled={busy}>
          Annuler
        </Button>
        <Button variant="accent" onPress={() => void submit()} isDisabled={busy || !name.trim()}>
          Créer
        </Button>
      </ButtonGroup>
    </Dialog>
  );
}
