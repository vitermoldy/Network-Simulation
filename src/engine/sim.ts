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
    this.queue.splice(lo, 0, task);
    return task;
  }

  /** Moves the clock forward. Returns 'step' when step mode stopped it at a decision. */
  advance(dt: number): 'ok' | 'step' {
    const target = this.time + dt;
    while (this.queue.length && this.queue[0].t <= target) {
      const task = this.queue.shift()!;
      if (task.cancelled) continue;
      this.time = Math.max(this.time, task.t);
      task.run();
      this.version++;
      if (this.stepMode && task.stop) {
        this.pruneLost();
        return 'step';
      }
    }
    this.time = target;
    this.pruneLost();
    return 'ok';
  }

  /** Nothing on a cable and nothing inside a device: the run is only waiting on a timer. */
  get quiet(): boolean {
    return this.flights.length === 0 && this.holds.length === 0;
  }

  private pruneLost(): void {
    const before = this.lost.length;
    this.lost = this.lost.filter((l) => this.time - l.t < 2.2);
    if (this.lost.length !== before) this.version++;
  }

  // ------------------------------------------------------------------ run control

  private resetApps(host: string, deviceId: string): void {
    this.client = {
      deviceId, host, dnsTxid: 4021, dnsDone: false, tcp: 'closed', synSentAt: 0, synRetried: false,
      sndNext: CLIENT_ISS, rcvNext: 0, getLen: 0, buffer: new Map(), complete: false,
    };
    this.servers.clear();
  }

  /** Opens a web page from a PC or laptop: ARP, DNS, TCP, HTTP, and the page on its screen. */
  start(rawHost: string, seed?: number, sourceId = 'pc'): void {
    const host = rawHost.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase() || 'www.jaringan.test';
    this.kind = 'web';
    this.resetRun(host, sourceId, seed);
    this.setPhase('input', 'active');
    const pc = this.checkSource(sourceId, true);
    if (!pc) return;
    this.note('info', pc.id, 'Input: alamat diketik', `Browser di ${pc.name} menerima alamat http://${host}/. Sebelum bisa mengirim apa pun, browser perlu tahu alamat IP server untuk nama itu.`, 7);
    this.schedule(0.8, () => {
      this.setPhase('input', 'done');
      this.dnsLookup();
    }, true);
  }

  /**
   * ping from a PC, laptop, server or router: four ICMP echo requests, one after the other.
   * A name is looked up in DNS first; a router can only ping an address.
   */
  startPing(sourceId: string, rawTarget: string, seed?: number, count = 4): void {
    const target = rawTarget.trim().toLowerCase();
    this.kind = 'ping';
    this.resetRun(target, sourceId, seed);
    this.ping = { target, ip: undefined, count, seq: 0, sent: 0, received: 0, times: [], id: 1 + Math.floor(this.rng() * 900) };
    this.setPhase('input', 'active');
    const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(target);
    const dev = this.checkSource(sourceId, !isIp);
    if (!dev) return;
    if (dev.kind === 'router') this.setPhase('arp', 'skipped');
    this.say(`Pinging ${target} with 32 bytes of data:`);
    this.say('');
    this.note('info', dev.id, 'Input: perintah ping', `${dev.name} menjalankan ping ${target}. Ping mengirim paket ICMP echo request; perangkat tujuan yang hidup akan membalas echo reply. Ini cara tercepat memeriksa apakah dua perangkat bisa saling mencapai.`, 3);
    this.schedule(0.6, () => {
      this.setPhase('input', 'done');
      if (isIp) {
        this.setPhase('dns', 'skipped');
        this.ping!.ip = target;
        this.pingNext();
      } else this.dnsLookup();
    }, true);
  }

  /** nslookup from a PC or laptop: only the DNS question and its answer. */
  startLookup(sourceId: string, rawName: string, seed?: number): void {
    const name = rawName.trim().toLowerCase();
    this.kind = 'lookup';
    this.resetRun(name, sourceId, seed);
    this.setPhase('input', 'active');
    const dev = this.checkSource(sourceId, true);
    if (!dev) return;
    this.note('info', dev.id, 'Input: perintah nslookup', `${dev.name} menanyakan nama ${name} ke server DNS-nya, tanpa membuka halaman apa pun.`, 7);
    this.schedule(0.6, () => {
      this.setPhase('input', 'done');
      this.dnsLookup();
    }, true);
  }

  /** Checks the sender can send at all; fails the run with the reason when it cannot. */
  private checkSource(sourceId: string, needDns: boolean): Device | undefined {
    const dev = this.topo.has(sourceId) ? this.topo.device(sourceId) : undefined;
    const allowed = dev && (this.kind === 'ping' ? dev.kind !== 'switch' : isClient(dev));
    if (!dev || !allowed) {
      this.fail('input', this.kind === 'ping' ? 'Ping hanya bisa dari PC, laptop, server, atau router.' : 'Pilih PC atau laptop sebagai pengirim. Tambahkan satu dari palet perangkat kalau belum ada.');
      return undefined;
    }
    if (!dev.powered) {
      this.fail('input', `${dev.name} mati. Nyalakan dulu lewat tombol power-nya.`, dev.id);
      this.browser.state = 'off';
      return undefined;
    }
    if (dev.kind === 'router') {
      if (needDns) {
        this.fail('input', 'Router di simulasi ini hanya bisa ping ke alamat IP, bukan ke nama.', dev.id);
        return undefined;
      }
      return dev;
    }
    const nic = dev.ports[0];
    const missing = !nic.ip ? 'alamat IP' : !dev.gateway ? 'gateway' : needDns && !dev.dnsServer ? 'server DNS' : '';
    if (missing) {
      this.fail('input', `${dev.name} belum punya ${missing}. Isi di tab Config, atau tekan IP otomatis.`, dev.id);
      return undefined;
    }
    return dev;
  }

  /** One line of text for the Command Prompt or CLI that started the run. */
  private say(line: string): void {
    this.output.push(line);
    this.version++;
  }

  private resetRun(label: string, sourceId: string, seed?: number): void {
    const host = label;
    if (seed !== undefined) this.rng = mulberry32(seed);
    this.output = [];
    this.failReason = '';
    this.ping = undefined;
    for (const t of this.queue) t.cancelled = true;
    this.queue = [];
    this.time = 0;
    this.flights = [];
    this.holds = [];
    this.lost = [];
    this.log = [];
    this.retx.clear();
    this.arpPending.clear();
    this.fired.clear();
    this.macTables.clear();
    this.arpCaches.clear();
    this.dnsCache.clear();
    this.activity.clear();
    this.history.clear();
    this.trace.clear();
    this.converging = false;
    this.srtt = 0;
    this.phases = PHASE_SETS[this.kind].map((p) => ({ ...p, status: 'waiting' }));
    this.routes = computeRoutes(this.topo);
    this.resetApps(host, sourceId);
    if (this.kind === 'web') {
      this.browser = { deviceId: sourceId, url: host, state: 'resolving', parts: PAGE_PARTS.map(() => false), message: 'Mencari alamat IP' };
    }
    this.outputDevice = sourceId;
    this.status = 'running';
    this.version++;
  }

  /** Stops everything and brings the scene back to rest. */
  stop(): void {
    for (const t of this.queue) t.cancelled = true;
    this.queue = [];
    this.flights = [];
    this.holds = [];
    this.lost = [];
    this.retx.clear();
    this.arpPending.clear();
    this.status = 'idle';
    this.phases = PHASES.map((p) => ({ ...p, status: 'waiting' }));
    this.log = [];
    const pc = this.topo.has(this.browser.deviceId) ? this.topo.device(this.browser.deviceId) : undefined;
    this.browser = { deviceId: this.browser.deviceId, url: this.browser.url, state: pc && !pc.powered ? 'off' : 'idle', parts: PAGE_PARTS.map(() => false) };
    this.time = 0;
    this.version++;
  }

  private setPhase(id: PhaseId, status: PhaseStatus): void {
    const p = this.phases.find((x) => x.id === id)!;
    if (p.status === status) return;
    if (p.status === 'done' && status === 'active') return;
    p.status = status;
    this.version++;
  }

  private fail(phase: PhaseId, reason: string, deviceId?: string): void {
    if (this.status !== 'running') return;
    this.setPhase(phase, 'failed');
    for (const p of this.phases) if (p.status === 'active') p.status = 'failed';
    this.status = 'failed';
    for (const r of this.retx.values()) if (r.timer) r.timer.cancelled = true;
    this.retx.clear();
    for (const a of this.arpPending.values()) if (a.timer) a.timer.cancelled = true;
    this.arpPending.clear();
    if (this.kind === 'web' && this.browser.state !== 'off') {
      this.browser.state = 'error';
      this.browser.message = reason;
    }
    this.failReason = reason;
    if (this.kind !== 'web' && phase === 'input') this.say(reason);
    this.note('error', deviceId, 'Gagal', reason);
  }

  private note(kind: LogKind, deviceId: string | undefined, title: string, text: string, layer?: LayerId, packetId?: number): void {
    this.log.push({ id: this.nextLog++, t: this.time, kind, deviceId, packetId, layer, title, text });
    this.version++;
  }

  // ------------------------------------------------------------------ hands-on changes

  setPower(deviceId: string, on: boolean): void {
    const dev = this.topo.device(deviceId);
    if (dev.powered === on) return;
    this.topo.setPower(deviceId, on);
    if (!on) {
      for (const p of dev.ports) {
        const link = this.topo.linkOf(p.id);
        if (link) this.cutLink(link.id, `${dev.name} dimatikan saat paket masih di kabel.`);
      }
      for (const h of [...this.holds]) {
        if (h.deviceId === deviceId) this.loseHold(h, `${dev.name} dimatikan saat paket sedang diproses di dalamnya.`);
      }
      this.macTables.delete(deviceId);
      this.arpCaches.delete(deviceId);
      if (deviceId === this.browser.deviceId) {
        this.browser.state = 'off';
        this.browser.message = undefined;
        if (this.status === 'running') this.fail(this.activePhase() ?? 'input', `${dev.name} dimatikan di tengah proses, jadi permintaan berhenti.`, deviceId);
      }
    } else if (deviceId === this.browser.deviceId && this.browser.state === 'off') {
      this.browser.state = 'idle';
    }
    if (this.status === 'running') {
      this.note('change', deviceId, on ? 'Perangkat dinyalakan' : 'Perangkat dimatikan', on
        ? `${dev.name} menyala lagi. Lampu link di port yang berkabel kembali hidup.`
        : `${dev.name} mati. Semua port-nya padam, jadi kabel yang terpasang tidak lagi membawa sinyal.`);
    }
    this.topologyChanged();
  }

  connect(a: string, b: string): { ok: true } | { ok: false; reason: string } {
    const res = this.topo.connect(a, b);
    if (!res.ok) return res;
    if (this.status === 'running') {
      this.note('change', this.topo.port(a).deviceId, 'Kabel dipasang', `Kabel baru: ${this.topo.portLabel(a)} ke ${this.topo.portLabel(b)}.`, 1);
    }
    this.topologyChanged();
    return { ok: true };
  }

  disconnect(linkId: string): void {
    const link = this.topo.links.get(linkId);
    if (!link) return;
    const label = `${this.topo.portLabel(link.a)} ke ${this.topo.portLabel(link.b)}`;
    this.cutLink(linkId, 'Kabel dicabut saat paket masih di dalamnya.');
    this.topo.disconnect(linkId);
    if (this.status === 'running') this.note('change', this.topo.port(link.a).deviceId, 'Kabel dicabut', `Kabel ${label} dicabut.`, 1);
    this.topologyChanged();
  }

  resetTopology(): void {
    this.replaceTopology(() => this.topo.reset());
  }

  /** Swaps in a saved network. A run in progress stops, since its devices may be gone. */
  loadTopology(data: unknown): void {
    this.replaceTopology(() => this.topo.load(data));
  }

  private replaceTopology(change: () => void): void {
    if (this.status !== 'idle') this.stop();
    change();
    this.macTables.clear();
    this.arpCaches.clear();
    const first = [...this.topo.devices.values()].find(isClient);
    this.browser = { deviceId: first?.id ?? '', url: this.browser.url, state: 'idle', parts: PAGE_PARTS.map(() => false) };
    this.topologyChanged();
  }

  addDevice(kind: Device['kind'], x: number, z: number): Device {
    const d = this.topo.addDevice(kind, x, z);
    if (this.status === 'running') this.note('change', d.id, 'Perangkat ditambah', `${d.name} ditaruh di meja.`);
    this.topologyChanged();
    return d;
  }

  removeDevice(id: string): void {
    const dev = this.topo.device(id);
    for (const p of dev.ports) {
      const link = this.topo.linkOf(p.id);
      if (link) this.cutLink(link.id, `${dev.name} diangkat dari meja saat paket masih di kabel.`);
    }
    for (const h of [...this.holds]) if (h.deviceId === id) this.loseHold(h, `${dev.name} diangkat dari meja.`);
    this.lost = this.lost.filter((l) => l.deviceId !== id);
    this.macTables.delete(id);
    this.arpCaches.delete(id);
    const wasClient = this.status === 'running' && id === this.client.deviceId;
    this.topo.removeDevice(id);
    if (wasClient) this.fail(this.activePhase() ?? 'input', `${dev.name} dihapus, jadi tidak ada lagi yang menunggu jawaban.`);
    else if (this.status === 'running') this.note('change', undefined, 'Perangkat dihapus', `${dev.name} dan kabelnya diangkat dari meja.`);
    this.topologyChanged();
  }

  moveDevice(id: string, x: number, z: number): void {
    this.topo.moveDevice(id, x, z);
    this.version++;
  }

  /**
   * Any other settings change (IP, gateway, DNS, services, records, names) goes through here,
   * so routers recompute their tables the same way they do after a cable change.
   */
  edit<T>(change: (t: Topology) => T): T {
    const out = change(this.topo);
    this.topologyChanged();
    return out;
  }

  private topologyChanged(): void {
    // A switch forgets addresses learned on a port that went dark.
    for (const [sw, table] of this.macTables) {
      if (!this.topo.has(sw) || !this.topo.device(sw).powered) {
        this.macTables.delete(sw);
        continue;
      }
      for (const [mac, port] of table) if (!this.topo.hasPort(port) || !this.topo.carrier(port)) table.delete(mac);
    }
    if (this.status !== 'running') {
      this.routes = computeRoutes(this.topo);
      this.version++;
      return;
    }
    if (this.convergeTask) this.convergeTask.cancelled = true;
