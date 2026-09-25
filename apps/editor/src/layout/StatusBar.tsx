import { useApp } from '../state/app';

export function StatusBar() {
  const project = useApp((s) => s.project);
  const jobs = useApp((s) => s.jobs);
  const planner = useApp((s) => s.planner);
  const chatRunning = useApp((s) => s.chat.running);
  const running = jobs.filter((j) => j.status === 'running' || j.status === 'queued');
  const review = planner?.review;
  return (
    <footer className="fg-status">
      <span>
        <span className="fg-dot" style={{ background: 'var(--fg-ok)' }} />
        Serveur connecté
      </span>
      {project && <span>{project.assets.length} assets</span>}
      {running.length > 0 && (
        <span style={{ color: 'var(--fg-accent-2)' }}>
          ⏳ {running.length} génération{running.length > 1 ? 's' : ''} : {running[0]?.progress}
        </span>
      )}
      {chatRunning && <span style={{ color: 'var(--fg-accent-2)' }}>💬 L'assistant répond…</span>}
      <span className="fg-spacer" />
      {review && (
        <span>
          Planning : {review.stats.percent} % · {review.overdue.length} en retard · prochaine action :{' '}
          {review.next[0]?.title ?? '—'}
        </span>
      )}
    </footer>
  );
}
