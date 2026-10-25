// Every tool call, from typed intents and from the OpenAI voice agent alike, is announced so the conversation can show
// its work: which function ran, with which arguments, and what official data came back. Numbers only ever come from here.
export interface ToolTrace { name: string; args: unknown; ok: boolean; summary: string; ms: number; via: 'voice' | 'local' }

export function announce(trace: ToolTrace) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('zouave:trace', { detail: trace }));
}

const short = (value: unknown) => typeof value === 'number' ? String(Math.round(value * 1e4) / 1e4) : typeof value === 'string' ? `"${value.length > 34 ? `${value.slice(0, 33)}…` : value}"` : JSON.stringify(value);
export function formatArgs(args: unknown) {
  if (!args || typeof args !== 'object') return '';
  return Object.entries(args as Record<string, unknown>).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => `${key}: ${short(value)}`).join(', ');
}

/** One line a human can read: the key figure and its source, never more than the tool returned. */
export function summarize(name: string, result: unknown): string {
  const r = (result ?? {}) as Record<string, any>;
  if (r.error) return String(r.error);
  switch (name) {
    case 'niveau_seine': return `${Number(r.hauteur_m).toLocaleString('en-GB', { maximumFractionDigits: 2 })} m at Austerlitz${r.stale ? ' (last known)' : ''} · ${r.source ?? 'Hub’Eau'}`;
    case 'aller_a': return `${r.label} · ${r.source ?? 'IGN'}${r.offline ? ' (offline)' : ''}`;
    case 'exposition': return r.scenario === 'pire' ? `SDRIF-E footprint: ${r.sdrife_en_zone ? 'inside' : 'outside'} · depths not published` : `${r.hauteur_texte ?? r.label ?? '—'}${r.cave_inondee_1910 ? ' · cellar sector' : ''} · PPRI`;
    case 'afficher_scenario': return `${r.scenario === 'pire' ? 'extreme' : r.scenario === 'aujourdhui' ? 'today' : r.scenario} · ${r.source ?? ''}`;
    case 'afficher_crue': return `${Number(r.level).toLocaleString('en-GB')} m · ${r.label ?? ''} · ${r.exposure?.hauteur_texte ?? ''}`;
    case 'consignes': return `${r.consignes?.length ?? 0} official actions · ${r.source ?? ''}`;
    case 'photo_inondee': return r.affichee ? `street simulation at ${r.hauteur_m ?? '?'} m` : 'no simulation shown';
    default: return 'done';
  }
}

/** Wraps tool functions so each call is announced; arguments and results pass through untouched. */
export function traced<T extends Record<string, (args: any, ...rest: any[]) => Promise<any>>>(tools: T, via: ToolTrace['via']): T {
  return Object.fromEntries(Object.entries(tools).map(([name, tool]) => [name, async (args: unknown, ...rest: unknown[]) => {
    const started = performance.now();
    try {
      const result = await tool(args, ...rest);
      announce({ name, args, ok: !(result && typeof result === 'object' && 'error' in result && result.error), summary: summarize(name, result), ms: Math.round(performance.now() - started), via });
      return result;
    } catch (error) {
      announce({ name, args, ok: false, summary: error instanceof Error ? error.message : String(error), ms: Math.round(performance.now() - started), via });
      throw error;
    }
  }])) as T;
}
