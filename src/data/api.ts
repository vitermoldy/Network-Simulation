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
