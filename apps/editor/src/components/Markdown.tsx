import { Fragment, type ReactNode } from 'react';

/**
 * Rendu Markdown minimal et sûr (aucun HTML injecté) pour les réponses de l'assistant :
 * titres, listes, blocs de code, gras, italique, code en ligne, liens http(s).
 */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (line.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] as string).startsWith('```')) code.push(lines[i++] as string);
      i++;
      blocks.push(
        <pre key={key++}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const content = inline(heading[2] ?? '');
      blocks.push((heading[1]?.length ?? 1) <= 2 ? <h3 key={key++}>{content}</h3> : <h4 key={key++}>{content}</h4>);
      i++;
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i] as string)) {
        items.push(<li key={items.length}>{inline((lines[i] as string).replace(/^\s*([-*•]|\d+[.)])\s+/, ''))}</li>);
        i++;
      }
      blocks.push(ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] as string).trim() &&
      !(lines[i] as string).startsWith('```') &&
      !/^(#{1,4})\s/.test(lines[i] as string) &&
      !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i] as string)
    ) {
      para.push(lines[i++] as string);
    }
    blocks.push(
      <p key={key++}>
        {para.map((l, n) => (
          <Fragment key={n}>
            {n > 0 && <br />}
            {inline(l)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <>{blocks}</>;
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let n = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('`')) out.push(<code key={n++}>{token.slice(1, -1)}</code>);
    else if (token.startsWith('**')) out.push(<strong key={n++}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('*')) out.push(<em key={n++}>{token.slice(1, -1)}</em>);
    else {
      const label = /^\[([^\]]+)\]/.exec(token)?.[1] ?? token;
      out.push(
        <a key={n++} href={match[5]} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--fg-accent-2)' }}>
          {label}
        </a>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
