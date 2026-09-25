import {
  ActionButton,
  AlertDialog,
  Button,
  DialogContainer,
  ProgressCircle,
  TextArea,
  Tooltip,
  TooltipTrigger,
} from '@adobe/react-spectrum';
import Delete from '@spectrum-icons/workflow/Delete';
import Send from '@spectrum-icons/workflow/Send';
import Stop from '@spectrum-icons/workflow/Stop';
import { useEffect, useRef, useState } from 'react';
import { api, type DisplayMessage } from '../api';
import { Markdown } from '../components/Markdown';
import { requireProjectId, toastError, useApp } from '../state/app';

const SUGGESTIONS_AI = [
  'Planifie le développement de mon jeu sur 3 mois, avec des jalons réalistes.',
  "Fais une revue de l'avancement et dis-moi quoi faire aujourd'hui.",
  'Propose un concept, un univers et trois personnages pour ce jeu, puis mémorise nos choix.',
  'Génère un décor de forêt enchantée au crépuscule (alias « bg foret »).',
  "Écris la scène d'introduction dans le script et vérifie qu'elle n'a pas d'erreur.",
];

const SUGGESTIONS_OFFLINE = [
  '/aide',
  '/taches',
  '/revue',
  '/tache Écrire le prologue !haute ~3h',
  '/generer sfx pièce',
];

/** Assistant de production : chat avec l'IA (ou commandes hors-ligne). */
export function ChatPanel() {
  const project = useApp((s) => s.project);
  const chat = useApp((s) => s.chat);
  const [draft, setDraft] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const lastText = chat.messages.at(-1)?.text.length ?? 0;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, lastText, chat.thinking]);

  if (!project) return null;

  const send = async (text = draft) => {
    const message = text.trim();
    if (!message || chat.running) return;
    setDraft('');
    try {
      await api.sendChat(requireProjectId(), message);
    } catch (error) {
      toastError(error);
      setDraft(message);
    }
  };

  const suggestions = chat.ai ? SUGGESTIONS_AI : SUGGESTIONS_OFFLINE;

  return (
    <div className="fg-panel">
      <div className="fg-toolbar">
        <span style={{ fontSize: 12, color: 'var(--fg-text-2)' }}>
          {chat.ai ? 'Assistant de production (Claude)' : 'Mode hors-ligne — commandes /…'}
        </span>
        <div className="fg-spacer" />
        <TooltipTrigger>
          <ActionButton
            isQuiet
            aria-label="Effacer la conversation"
            onPress={() => setConfirmClear(true)}
            isDisabled={chat.running || chat.messages.length === 0}
          >
            <Delete />
          </ActionButton>
          <Tooltip>Nouvelle conversation (l'ancienne est archivée ; la mémoire du projet est conservée)</Tooltip>
        </TooltipTrigger>
      </div>
      <div className="fg-chat-list" ref={listRef}>
        {chat.messages.length === 0 && (
          <div className="fg-empty" style={{ height: 'auto', paddingTop: 30 }}>
            <div style={{ fontSize: 14, color: 'var(--fg-text)' }}>
              {chat.ai ? "Que construisons-nous aujourd'hui ?" : 'Assistant hors-ligne'}
            </div>
            <div>
              {chat.ai
                ? "L'assistant connaît votre planning, la mémoire du projet et ses fichiers. Il peut planifier, générer des assets et écrire vos scripts."
                : 'Sans clé API, gérez le planning avec des commandes. Tapez /aide pour la liste.'}
            </div>
          </div>
        )}
        {chat.messages.map((m) => (
          <ChatMessage key={m.id} message={m} />
        ))}
        {chat.running && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--fg-text-3)' }}>
            <ProgressCircle aria-label="Réponse en cours" isIndeterminate size="S" />
            {chat.thinking ? 'Réflexion…' : "L'assistant travaille…"}
          </div>
        )}
      </div>
      {chat.messages.length === 0 && (
        <div className="fg-chips">
          {suggestions.map((s) => (
            <button key={s} className="fg-chip" onClick={() => (s.startsWith('/') ? setDraft(s) : void send(s))}>
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="fg-chat-input">
        <TextArea
          aria-label="Message"
          value={draft}
          onChange={setDraft}
          width="100%"
          placeholder={
            chat.ai ? "Écrivez à l'assistant… (Entrée pour envoyer, Maj+Entrée pour aller à la ligne)" : 'Tapez /aide…'
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            } else e.continuePropagation();
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          {chat.running ? (
            <Button variant="secondary" onPress={() => void api.stopChat(requireProjectId()).catch(toastError)}>
              <Stop />
              Interrompre
            </Button>
          ) : (
            <Button variant="accent" onPress={() => void send()} isDisabled={!draft.trim()}>
              <Send />
              Envoyer
            </Button>
          )}
        </div>
      </div>
      <DialogContainer onDismiss={() => setConfirmClear(false)}>
        {confirmClear && (
          <AlertDialog
            title="Nouvelle conversation ?"
            variant="confirmation"
            primaryActionLabel="Effacer"
            cancelLabel="Annuler"
            onPrimaryAction={() => void api.clearChat(requireProjectId()).catch(toastError)}
          >
            La conversation actuelle sera archivée dans le projet. Le planning et la mémoire du projet sont conservés.
          </AlertDialog>
        )}
      </DialogContainer>
    </div>
  );
}

function ChatMessage({ message }: { message: DisplayMessage }) {
  if (message.role === 'tool' && message.tool) {
    const status = message.tool.ok === undefined ? '⏳' : message.tool.ok ? '✓' : '✗';
    return (
      <div className={`fg-tool ${message.tool.ok === false ? 'error' : ''}`}>
        <span>
          {status} {message.text}
        </span>
        <details>
          <summary>Détails</summary>
          <pre>{JSON.stringify(message.tool.input, null, 2)}</pre>
          {message.tool.result && <pre>{message.tool.result}</pre>}
        </details>
      </div>
    );
  }
  if (message.role === 'user') return <div className="fg-msg user">{message.text}</div>;
  return (
    <div className={`fg-msg ${message.role}`}>
      <Markdown text={message.text} />
    </div>
  );
}
