/** Utilitaires de dates calendaires `AAAA-MM-JJ` (en UTC, pour éviter les décalages de fuseau). */

export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

export function addDays(value: string, days: number): string {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

export function addMonths(value: string, months: number): string {
  const date = parseDate(value);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return toDateString(date);
}

/** Nombre de jours de `a` à `b` (positif si `b` est après `a`). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000);
}

export function isWeekend(value: string): boolean {
  const day = parseDate(value).getUTCDay();
  return day === 0 || day === 6;
}

/** Ajoute `days` jours ouvrés (lundi–vendredi). */
export function addWorkDays(value: string, days: number): string {
  let current = value;
  while (isWeekend(current)) current = addDays(current, 1);
  let remaining = days;
  while (remaining > 0) {
    current = addDays(current, 1);
    if (!isWeekend(current)) remaining--;
  }
  return current;
}

export function maxDate(...dates: (string | undefined)[]): string | undefined {
  return dates.filter((d): d is string => Boolean(d)).sort().at(-1);
}
