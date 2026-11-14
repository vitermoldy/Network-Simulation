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
    this.converging = true;
    this.convergeTask = this.schedule(this.time + TIMING.converge, () => this.converge(), true);
    this.version++;
  }

  private converge(): void {
    const before = this.routes;
    this.routes = computeRoutes(this.topo);
    this.converging = false;
    const lines = describeRouteChanges(this.topo, before, this.routes);
    this.note('route', undefined, 'Rute dihitung ulang', lines.length
      ? `Router saling bertukar kabar (link-state, seperti OSPF) lalu menghitung jalur terpendek lagi. ${lines.join(' ')}`
      : 'Router saling bertukar kabar dan menghitung jalur lagi. Tidak ada rute yang berubah.', 3);
  }

  private activePhase(): PhaseId | undefined {
    return this.phases.find((p) => p.status === 'active')?.id;
  }

  // ------------------------------------------------------------------ wire

  private newPacket(p: Omit<Packet, 'id' | 'retry' | 'hops'> & { retry?: number }): Packet {
    return { retry: 0, hops: 0, ...p, id: this.nextPacket++ };
  }

  private record(p: Packet, deviceId: string, outgoing: boolean): void {
    if (outgoing) {
      const versions = this.history.get(p.id) ?? [];
      versions.push(clonePacket(p));
      this.history.set(p.id, versions);
    }
    const tr = this.trace.get(p.id) ?? [];
    if (tr[tr.length - 1] !== deviceId) tr.push(deviceId);
    this.trace.set(p.id, tr);
  }

  private emit(portId: string, packet: Packet): void {
    const dev = this.topo.deviceOf(portId);
    const link = this.topo.linkOf(portId);
    this.record(packet, dev.id, true);
    if (!link) {
      this.loseAt(packet, dev.id, `Tidak ada kabel di port ${this.topo.port(portId).name} milik ${dev.name}, jadi paket tidak bisa keluar.`);
      return;
    }
    const to = link.a === portId ? link.b : link.a;
    if (!this.topo.carrier(portId)) {
      this.loseAt(packet, dev.id, `${this.topo.deviceOf(to).name} di ujung kabel sedang mati, jadi tidak ada sinyal di kabel itu.`);
      return;
    }
    packet.hops++;
    const f: Flight = { id: this.nextFlight++, packet, linkId: link.id, from: portId, to, t0: this.time, t1: this.time + TIMING.hop };
    this.flights.push(f);
    this.activity.set(portId, this.time);
    const drop = this.planDrop(packet);
    if (drop) {
      this.schedule(f.t0 + (f.t1 - f.t0) * drop.u, () => {
        if (this.flights.includes(f)) this.loseFlight(f, drop.reason);
      }, true);
    } else {
      this.schedule(f.t1, () => {
        if (this.flights.includes(f)) this.arrive(f);
      }, true);
    }
    this.version++;
  }

  private planDrop(p: Packet): { u: number; reason: string } | undefined {
    if (this.scenario === 'loss' && !this.fired.has('loss') && p.app?.part === 2 && p.retry === 0 && p.hops === 2) {
      this.fired.add('loss');
      return { u: 0.55, reason: 'Segmen 2 rusak oleh gangguan di kabel. Router penerima menghitung ulang FCS (cek kesalahan di ujung frame), hasilnya tidak cocok, jadi frame dibuang.' };
    }
    if (this.lossRate > 0 && this.rng() < this.lossRate) {
      return { u: 0.3 + this.rng() * 0.4, reason: 'Gangguan acak merusak frame ini di kabel. Cek FCS di penerima gagal, jadi frame dibuang.' };
    }
    return undefined;
  }

  private cutLink(linkId: string, reason: string): void {
    for (const f of [...this.flights]) if (f.linkId === linkId) this.loseFlight(f, reason);
  }

  private loseFlight(f: Flight, reason: string): void {
    this.flights = this.flights.filter((x) => x !== f);
    this.lost.push({ packet: f.packet, t: this.time, reason, kind: 'lost' });
    this.note('loss', undefined, `${f.packet.label} hilang`, `${f.packet.title}: hilang di kabel ${this.topo.portLabel(f.from)} ke ${this.topo.portLabel(f.to)}. ${reason}`, 1, f.packet.id);
  }

  private loseAt(packet: Packet, deviceId: string, reason: string): void {
    this.lost.push({ packet, t: this.time, reason, kind: 'lost', deviceId });
    this.note('loss', deviceId, `${packet.label} hilang`, `${packet.title}: ${reason}`, undefined, packet.id);
  }

  private discard(packet: Packet, deviceId: string, reason: string): void {
    this.lost.push({ packet, t: this.time, reason, kind: 'discard', deviceId });
    this.note('info', deviceId, 'Frame diabaikan', `${this.topo.device(deviceId).name}: ${reason}`, 2, packet.id);
  }

  private loseHold(h: Hold, reason: string): void {
    this.holds = this.holds.filter((x) => x !== h);
    this.loseAt(h.packet, h.deviceId, reason);
  }

  private hold(packet: Packet, dev: Device, inPort: string, outPorts: string[], dur: number, then: () => void): void {
    const h: Hold = { packet, deviceId: dev.id, inPort, outPorts, t0: this.time, t1: this.time + dur };
    this.holds.push(h);
    this.schedule(h.t1, () => {
      if (!this.holds.includes(h)) return;
      this.holds = this.holds.filter((x) => x !== h);
      if (!dev.powered) return;
      then();
    });
  }

  private arrive(f: Flight): void {
    this.flights = this.flights.filter((x) => x !== f);
    this.activity.set(f.to, this.time);
    const dev = this.topo.deviceOf(f.to);
    this.record(f.packet, dev.id, false);
    if (!dev.powered) {
      this.loseAt(f.packet, dev.id, `${dev.name} sedang mati.`);
      return;
    }
    if (dev.kind === 'switch') this.switchIn(dev, f.to, f.packet);
    else if (dev.kind === 'router') this.routerIn(dev, f.to, f.packet);
    else this.hostIn(dev, f.to, f.packet);
  }

  // ------------------------------------------------------------------ devices

  macTable(id: string): Map<string, string> {
    let t = this.macTables.get(id);
    if (!t) {
      t = new Map();
      this.macTables.set(id, t);
    }
    return t;
  }

  arpCache(id: string): Map<string, string> {
    let t = this.arpCaches.get(id);
    if (!t) {
      t = new Map();
      this.arpCaches.set(id, t);
    }
    return t;
  }

  private switchIn(dev: Device, inPort: string, p: Packet): void {
    const table = this.macTable(dev.id);
    const inName = this.topo.port(inPort).name;
    const learned = table.get(p.eth.src) !== inPort;
    table.set(p.eth.src, inPort);
    const others = dev.ports.filter((q) => q.id !== inPort && this.topo.carrier(q.id)).map((q) => q.id);
    let outs: string[];
    let how: string;
    if (p.eth.dst === BROADCAST) {
      outs = others;
      how = `MAC tujuan ${BROADCAST} artinya broadcast, jadi frame disalin ke semua port yang tersambung kecuali ${inName}`;
    } else if (table.has(p.eth.dst)) {
      const o = table.get(p.eth.dst)!;
      outs = o === inPort ? [] : [o];
      how = `MAC tujuan ${p.eth.dst} sudah ada di tabel MAC (port ${this.topo.port(o).name}), jadi frame hanya diteruskan ke port itu`;
    } else {
      outs = others;
      how = `MAC tujuan ${p.eth.dst} belum ada di tabel MAC, jadi frame disebar (flooding) ke semua port lain`;
    }
    const names = outs.map((o) => this.topo.port(o).name).join(', ');
    const learnText = learned ? ` Switch juga mencatat bahwa ${p.eth.src} ada di ${inName}.` : '';
    this.note('info', dev.id, `${dev.name} meneruskan frame`, `Frame "${p.label}" masuk di ${inName}. Switch hanya membaca header Ethernet (lapisan 2). ${how}${outs.length ? ` (${names})` : ''}.${learnText}`, 2, p.id);
    this.hold(p, dev, inPort, outs, TIMING.switch, () => {
      if (!outs.length) {
        this.discard(p, dev.id, 'tidak ada port lain yang tersambung untuk frame ini.');
        return;
      }
      outs.forEach((o, i) => {
        if (i === 0) this.emit(o, p);
        else this.emit(o, { ...clonePacket(p), id: this.nextPacket++, copyOf: p.id, hops: p.hops });
      });
    });
  }

  private routerIn(dev: Device, inPort: string, p: Packet): void {
    const port = this.topo.port(inPort);
    if (p.eth.dst !== port.mac && p.eth.dst !== BROADCAST) {
      this.discard(p, dev.id, `MAC tujuan ${p.eth.dst} bukan milik port ${port.name}, frame dibuang.`);
      return;
    }
    if (p.arp) {
      if (p.arp.op === 'request' && port.ip && p.arp.targetIp === port.ip) {
        this.arpCache(dev.id).set(p.arp.senderIp, p.arp.senderMac);
        this.note('info', dev.id, `${dev.name} menjawab ARP`, `ARP menanyakan ${p.arp.targetIp}, yaitu IP port ${port.name} milik router ini. Router membalas dengan MAC ${port.mac} dan sekalian mencatat MAC ${p.arp.senderIp}.`, 2, p.id);
        this.hold(p, dev, inPort, [inPort], TIMING.router, () => {
          const reply = this.newPacket({
            flow: 'arp', label: 'ARP balas', title: `ARP: ${port.ip} ada di ${port.mac}`,
            eth: { src: port.mac, dst: p.arp!.senderMac, type: 'ARP' },
            arp: { op: 'reply', senderMac: port.mac, senderIp: port.ip!, targetMac: p.arp!.senderMac, targetIp: p.arp!.senderIp },
            size: 42,
          });
          this.emit(inPort, reply);
        });
      } else {
        this.discard(p, dev.id, `ARP ini menanyakan ${p.arp.targetIp}, bukan IP router, jadi router diam saja.`);
      }
      return;
    }
    if (!p.ip) {
      this.discard(p, dev.id, 'frame tanpa paket IP tidak diteruskan router.');
      return;
    }
    const own = dev.ports.find((q) => q.ip === p.ip!.dst);
    if (own) {
      this.note('info', dev.id, `${dev.name} menerima paket untuknya`, `IP tujuan ${p.ip.dst} adalah milik port ${own.name}, jadi paket ini tidak diteruskan. Router memprosesnya sendiri.`, 3, p.id);
      this.hold(p, dev, inPort, [], TIMING.router, () => {
        if (this.status !== 'running') return;
        if (p.icmp?.type === 'echo-request') this.icmpReply(dev, p);
        else if (p.icmp?.type === 'echo-reply' && dev.id === this.client.deviceId) this.icmpReceive(dev, p);
        else this.discard(p, dev.id, 'tidak ada layanan di router ini untuk paket tersebut.');
      });
      return;
    }
    const route = lookup(this.routes.get(dev.id), p.ip.dst);
    if (!route) {
      this.note('info', dev.id, `${dev.name} memeriksa tabel routing`, `IP tujuan ${p.ip.dst} tidak cocok dengan rute mana pun di tabel routing.`, 3, p.id);
      this.hold(p, dev, inPort, [], TIMING.router, () => this.loseAt(p, dev.id, `${dev.name} tidak punya rute ke ${p.ip!.dst}, jadi paket dibuang.`));
      return;
    }
    const ttl = p.ip.ttl - 1;
    const out = this.topo.port(route.portId);
    const nextHop = route.nextHop ?? p.ip.dst;
    const source = route.type === 'C' ? `terhubung langsung di ${out.name}` : `dipelajari dari ${this.topo.device(route.viaRouter!).name}, biaya ${route.cost}`;
    const stale = this.converging ? ' Router belum selesai menghitung ulang rute, jadi tabel lama masih dipakai.' : '';
    this.note('route', dev.id, `${dev.name} memilih jalan`, `Router membuka sampai header IP (lapisan 3). IP tujuan ${p.ip.dst} cocok dengan ${route.network} (${source}). Paket keluar lewat ${out.name} menuju ${nextHop}. Header Ethernet diganti dengan MAC baru, TTL turun dari ${p.ip.ttl} menjadi ${ttl}.${stale}`, 3, p.id);
    this.hold(p, dev, inPort, [route.portId], TIMING.router, () => {
      if (ttl <= 0) {
        this.loseAt(p, dev.id, 'TTL habis, paket dibuang supaya tidak berputar selamanya.');
        return;
      }
      const target = this.topo.findInSegment(route.portId, nextHop);
      if (!target) {
        this.loseAt(p, dev.id, `${dev.name} tidak menemukan ${nextHop} di port ${out.name}: kabel atau perangkat berikutnya putus.`);
        return;
      }
      const fwd = clonePacket(p);
      fwd.ip!.ttl = ttl;
      fwd.eth = { src: out.mac, dst: target.mac, type: 'IPv4' };
      this.emit(route.portId, fwd);
    });
  }

  private hostIn(dev: Device, inPort: string, p: Packet): void {
    const nic = this.topo.port(inPort);
    if (p.eth.dst !== nic.mac && p.eth.dst !== BROADCAST) {
      this.discard(p, dev.id, `MAC tujuan ${p.eth.dst} bukan milik kartu jaringannya, frame dibuang.`);
      return;
    }
    if (p.arp) {
      if (p.arp.op === 'request' && p.arp.targetIp === nic.ip) {
        this.note('info', dev.id, `${dev.name} menjawab ARP`, `ARP menanyakan ${nic.ip}, IP milik ${dev.name}. Balasan berisi MAC ${nic.mac}.`, 2, p.id);
        this.hold(p, dev, inPort, [inPort], TIMING.host, () => {
          const reply = this.newPacket({
            flow: 'arp', label: 'ARP balas', title: `ARP: ${nic.ip} ada di ${nic.mac}`,
            eth: { src: nic.mac, dst: p.arp!.senderMac, type: 'ARP' },
            arp: { op: 'reply', senderMac: nic.mac, senderIp: nic.ip!, targetMac: p.arp!.senderMac, targetIp: p.arp!.senderIp },
            size: 42,
          });
          this.emit(inPort, reply);
        });
      } else if (p.arp.op === 'reply' && p.arp.targetIp === nic.ip && dev.id === this.client.deviceId) {
        this.hold(p, dev, inPort, [], TIMING.host, () => this.arpResolved(dev, p.arp!.senderIp, p.arp!.senderMac, p.id));
      } else {
        this.discard(p, dev.id, `ARP ini untuk ${p.arp.targetIp}, bukan untuk ${dev.name}.`);
      }
      return;
    }
    if (!p.ip || p.ip.dst !== nic.ip) {
      this.discard(p, dev.id, 'IP tujuan bukan miliknya.');
      return;
    }
    this.hold(p, dev, inPort, [], TIMING.host, () => {
      if (this.status !== 'running') return;
      if (p.icmp) {
        if (p.icmp.type === 'echo-request') this.icmpReply(dev, p);
        else if (dev.id === this.client.deviceId) this.icmpReceive(dev, p);
        return;
      }
      if (dev.id === this.client.deviceId) {
        this.clientReceive(dev, p);
        return;
      }
      if (dev.kind !== 'server') {
        this.discard(p, dev.id, 'paket ini ditujukan ke perangkat ini, tapi tidak ada program yang menunggunya.');
        return;
      }
      if (p.udp?.dst === 53) {
        if (dev.services?.dns) this.dnsReceive(dev, p);
        else this.discard(p, dev.id, 'layanan DNS tidak aktif di server ini, jadi pertanyaan DNS tidak dijawab.');
      } else if (p.tcp?.dst === 80) {
        if (dev.services?.http) this.webReceive(dev, p);
        else this.refuse(dev, p);
      }
