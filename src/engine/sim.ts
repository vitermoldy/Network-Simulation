// The simulator: a discrete-event clock that moves packets over cables, lets each device make its
// own decision when a packet arrives, and runs the small programs on the hosts (the browser on the
// laptop, the DNS server, the web server). Decisions use the topology as it is at that moment, so
// pulling a cable or switching a router off mid-run really loses packets and changes the route.

import { sameSubnet } from './ip';
import { BROADCAST, clonePacket, type LayerId, type Packet, type TcpFlag } from './packet';
import { computeRoutes, lookup, type Route } from './routing';
import { isClient, Topology, type Device, type Role } from './topology';

export const TIMING = {
  /** Seconds a frame spends on one cable at speed 1. */
  hop: 0.7,
  switch: 0.3,
  router: 0.4,
  host: 0.45,
  /** Routers need a moment to notice a change and agree on new routes. */
  converge: 2.5,
};

const RTO_INIT = 16;
const DNS_RTO = 11;
const ARP_RTO = 5;
const MAX_TCP_TRIES = 5;
const MAX_DNS_TRIES = 3;
const MAX_ARP_TRIES = 3;
const CLIENT_PORT = 49152;
const DNS_PORT_CLIENT = 53001;
const CLIENT_ISS = 1000;
const SERVER_ISS = 5000;
const SEGMENT = 400;

export const PAGE_PARTS: { lines: string[]; shows: string }[] = [
  {
    lines: ['HTTP/1.1 200 OK', 'Content-Type: text/html', 'Content-Length: 1200', '<header>jaringan.test</header>'],
    shows: 'kepala halaman',
  },
  {
    lines: ['<h1>Halo dari Server Web</h1>', '<p>Halaman ini dikirim server web lewat jaringan sampai ke layarmu.</p>'],
    shows: 'judul dan isi',
  },
  {
    lines: ['<footer>Dikirim dalam 3 segmen TCP</footer>', '</html>'],
    shows: 'kaki halaman',
  },
];
const RESPONSE_LEN = SEGMENT * PAGE_PARTS.length;

export type PhaseId = 'input' | 'arp' | 'dns' | 'tcp-open' | 'http-req' | 'http-res' | 'output' | 'tcp-close' | 'icmp';
export type PhaseStatus = 'waiting' | 'active' | 'done' | 'failed' | 'skipped';

export interface Phase {
  id: PhaseId;
  title: string;
  layer: string;
  role: Role;
  status: PhaseStatus;
}

/** What a run does: open a web page, ping an address, or only ask DNS for a name. */
export type RunKind = 'web' | 'ping' | 'lookup';

const PHASE_SETS: Record<RunKind, Omit<Phase, 'status'>[]> = {
  web: [
    { id: 'input', title: 'Alamat web diketik di browser', layer: 'Aplikasi', role: 'input' },
    { id: 'arp', title: 'ARP: mencari MAC gateway', layer: 'Data link', role: 'process' },
    { id: 'dns', title: 'DNS: menanyakan alamat IP', layer: 'Aplikasi, UDP', role: 'process' },
    { id: 'tcp-open', title: 'TCP: jabat tangan 3 langkah', layer: 'Transport', role: 'process' },
    { id: 'http-req', title: 'HTTP: permintaan halaman', layer: 'Aplikasi', role: 'output' },
    { id: 'http-res', title: 'HTTP: halaman dikirim balik', layer: 'Aplikasi, TCP', role: 'output' },
    { id: 'output', title: 'Halaman tampil di layar pengirim', layer: 'Aplikasi', role: 'input' },
    { id: 'tcp-close', title: 'TCP: sambungan ditutup', layer: 'Transport', role: 'process' },
  ],
  ping: [
    { id: 'input', title: 'Perintah ping diketik', layer: 'Aplikasi', role: 'input' },
    { id: 'arp', title: 'ARP: mencari MAC tujuan berikutnya', layer: 'Data link', role: 'process' },
    { id: 'dns', title: 'DNS: menanyakan alamat IP', layer: 'Aplikasi, UDP', role: 'process' },
    { id: 'icmp', title: 'ICMP: echo request dan echo reply', layer: 'Jaringan', role: 'process' },
    { id: 'output', title: 'Hasil ping tampil', layer: 'Aplikasi', role: 'input' },
  ],
  lookup: [
    { id: 'input', title: 'Perintah nslookup diketik', layer: 'Aplikasi', role: 'input' },
    { id: 'arp', title: 'ARP: mencari MAC gateway', layer: 'Data link', role: 'process' },
    { id: 'dns', title: 'DNS: menanyakan alamat IP', layer: 'Aplikasi, UDP', role: 'process' },
    { id: 'output', title: 'Jawaban tampil', layer: 'Aplikasi', role: 'input' },
  ],
};
const PHASES = PHASE_SETS.web;
const PING_RTO = 18;

export type LogKind = 'info' | 'route' | 'loss' | 'retry' | 'ok' | 'error' | 'change';

export interface LogEntry {
  id: number;
  t: number;
  kind: LogKind;
  deviceId?: string;
  packetId?: number;
  layer?: LayerId;
  title: string;
  text: string;
}

export type Scenario = 'normal' | 'loss' | 'router-down' | 'bad-domain';

export interface Task {
  t: number;
  seq: number;
  run: () => void;
  /** In step mode the clock stops after this task. */
  stop: boolean;
  cancelled: boolean;
}

export interface Flight {
  id: number;
  packet: Packet;
  linkId: string;
  from: string;
  to: string;
  t0: number;
  t1: number;
}

export interface Hold {
  packet: Packet;
  deviceId: string;
  inPort: string;
  outPorts: string[];
  t0: number;
  t1: number;
}

export interface LostMark {
  packet: Packet;
  t: number;
  reason: string;
  /** lost = damaged or nowhere to go (red); discard = a device ignored a frame not meant for it. */
  kind: 'lost' | 'discard';
  deviceId?: string;
}

export type BrowserState = 'idle' | 'resolving' | 'connecting' | 'loading' | 'done' | 'error' | 'off';

export interface BrowserView {
  /** The PC or laptop whose screen shows this browser. */
  deviceId: string;
  url: string;
  state: BrowserState;
  parts: boolean[];
  message?: string;
  serverIp?: string;
}

export interface TimerView {
  key: string;
  label: string;
  deviceId: string;
  remaining: number;
  rto: number;
  tries: number;
}

interface Retx {
  key: string;
  label: string;
  dev: Device;
  make: (retry: number) => Packet;
  tries: number;
  maxTries: number;
  rto: number;
  firedAt: number;
  timer?: Task;
  onGiveUp: () => void;
}

interface ClientState {
  deviceId: string;
  host: string;
  serverIp?: string;
  dnsTxid: number;
  dnsDone: boolean;
  tcp: 'closed' | 'syn-sent' | 'established' | 'fin-wait' | 'time-wait';
  synSentAt: number;
  synRetried: boolean;
  sndNext: number;
  rcvNext: number;
  getLen: number;
  buffer: Map<number, Packet>;
  complete: boolean;
}

interface ServerState {
  state: 'listen' | 'syn-rcvd' | 'established' | 'last-ack' | 'closed';
  rcvNext: number;
  clientIp?: string;
  synAckAt: number;
  lastAck: number;
  responded: boolean;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fmt = (s: number) => `${Number.isInteger(s) ? s : s.toFixed(1)} s`;

export class Simulator {
  readonly topo: Topology;
  time = 0;
  status: 'idle' | 'running' | 'done' | 'failed' = 'idle';
  stepMode = false;
  lossRate = 0;
  scenario: Scenario = 'normal';
  kind: RunKind = 'web';
  /** Text the run prints for the Command Prompt or CLI that started it (ping, nslookup). */
  output: string[] = [];
  outputDevice = '';
  /** Why the last run failed, in words, for every kind of run. */
  failReason = '';
  phases: Phase[] = PHASES.map((p) => ({ ...p, status: 'waiting' }));
  log: LogEntry[] = [];
  flights: Flight[] = [];
  holds: Hold[] = [];
  lost: LostMark[] = [];
  routes = new Map<string, Route[]>();
  converging = false;
  macTables = new Map<string, Map<string, string>>();
  arpCaches = new Map<string, Map<string, string>>();
  dnsCache = new Map<string, string>();
  browser: BrowserView = { deviceId: 'pc', url: 'www.jaringan.test', state: 'idle', parts: PAGE_PARTS.map(() => false) };
  /** Sim time of the last frame through each port, for the activity LEDs. */
  activity = new Map<string, number>();
  /** Every header version a packet has had, oldest first; routers add one per hop. */
  history = new Map<number, Packet[]>();
  /** Device ids each packet has passed through, for tests and the path view. */
  trace = new Map<number, string[]>();
  /** Goes up on every visible change, so the interface can redraw only when needed. */
  version = 0;

  private queue: Task[] = [];
  private seq = 0;
  private nextPacket = 1;
  private nextFlight = 1;
  private nextLog = 1;
  private rng: () => number;
  private convergeTask?: Task;
  private retx = new Map<string, Retx>();
  private arpPending = new Map<string, { packets: Packet[]; tries: number; timer?: Task }>();
  private fired = new Set<string>();
  private client!: ClientState;
  private servers = new Map<string, ServerState>();
  private srtt = 0;
  private ping?: { target: string; ip?: string; count: number; seq: number; sent: number; received: number; times: number[]; id: number; timer?: Task; sentAt?: number };

  constructor(topo = new Topology(), seed = 7) {
    this.topo = topo;
    this.rng = mulberry32(seed);
    this.routes = computeRoutes(topo);
    this.resetApps('www.jaringan.test', 'pc');
  }

  /** The PC or laptop that sends the request in this run. */
  get clientId(): string {
    return this.client.deviceId;
  }

  private get cname(): string {
    return this.topo.has(this.client.deviceId) ? this.topo.device(this.client.deviceId).name : 'Pengirim';
  }

  private server(id: string): ServerState {
    let s = this.servers.get(id);
    if (!s) {
      s = { state: 'listen', rcvNext: 0, synAckAt: 0, lastAck: 0, responded: false };
      this.servers.set(id, s);
    }
    return s;
  }

  // ------------------------------------------------------------------ clock

  private schedule(t: number, run: () => void, stop = false): Task {
    const task: Task = { t, seq: this.seq++, run, stop, cancelled: false };
    let lo = 0;
    let hi = this.queue.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const q = this.queue[mid];
      if (q.t < t || (q.t === t && q.seq < task.seq)) lo = mid + 1;
      else hi = mid;
    }
