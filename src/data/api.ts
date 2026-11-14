// Talks to the small MySQL server (npm run server). Each browser is a 12-character client code
// kept in localStorage, the same scheme as the owner's other apps; there are no accounts.
// Finished runs wait in a local queue while the server is off and go out once it answers.

import type { TopologyData } from '../engine/topology';

const CODE_KEY = 'netsim-client';
const QUEUE_KEY = 'netsim-unsent-runs';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface RunRecord {
  host: string;
  source: string;
  scenario: string;
  lossRate: number;
  status: 'done' | 'failed';
  failedPhase?: string;
  reason?: string;
  simSeconds: number;
  packetsLost: number;
  resends: number;
  routeChanges: number;
  path: string[];
  devices: number;
  finishedAt: string;
}

export interface SavedRun extends RunRecord {
  id: number;
}

export interface LayoutSummary {
  id: number;
  name: string;
  devices: number;
  links: number;
  updatedAt: string;
}

let memoryCode: string | undefined;

function makeCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function clientCode(): string {
  try {
    let code = localStorage.getItem(CODE_KEY);
    if (!code || !/^[A-HJ-NP-Z2-9]{12}$/.test(code)) {
      code = makeCode();
      localStorage.setItem(CODE_KEY, code);
    }
    return code;
  } catch {
    memoryCode ??= makeCode();
    return memoryCode;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`api/${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Server menjawab ${res.status}.`);
  return body as T;
}

export async function health(): Promise<{ ok: boolean; database: string }> {
  return call('health');
}

function readQueue(): RunRecord[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const list = raw ? (JSON.parse(raw) as RunRecord[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeQueue(list: RunRecord[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(list.slice(-50)));
  } catch {
    /* the run is lost if storage is blocked; the history is a convenience */
  }
}

export function queuedRuns(): number {
  return readQueue().length;
}

/** Sends a run now, or keeps it for later when the server does not answer. */
export async function saveRun(run: RunRecord): Promise<boolean> {
  try {
    await call('runs', { method: 'POST', body: JSON.stringify({ client: clientCode(), run }) });
    return true;
  } catch {
    writeQueue([...readQueue(), run]);
    return false;
  }
}

export async function flushQueue(): Promise<number> {
  const list = readQueue();
  let sent = 0;
  for (const run of list) {
    try {
      await call('runs', { method: 'POST', body: JSON.stringify({ client: clientCode(), run }) });
      sent++;
    } catch {
      break;
    }
  }
  writeQueue(list.slice(sent));
  return sent;
}

