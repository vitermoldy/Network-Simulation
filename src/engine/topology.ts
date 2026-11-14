// The physical network: devices, their ports, and the cables between ports. Everything the user
// changes by hand (adding or removing a device, moving it, power, cables, IP settings, server
// services) changes this object; the simulator reads it at the moment each decision is made.

import { inNetwork, ipToInt, maskOf, networkOf } from './ip';

export type DeviceKind = 'pc' | 'laptop' | 'switch' | 'router' | 'server';
export type Role = 'input' | 'process' | 'output';

export interface Port {
  id: string;
  deviceId: string;
  name: string;
  mac: string;
  ip?: string;
  prefix?: number;
  /** Administratively down ("shutdown" in the CLI). New routers start this way, as in Packet Tracer. */
  down?: boolean;
}

/** Cisco-style long names for the CLI: Fa0/1 is FastEthernet0/1, G0/0 is GigabitEthernet0/0. */
export function longPortName(name: string): string {
  if (/^Fa/i.test(name)) return name.replace(/^Fa/i, 'FastEthernet');
  if (/^Gi/i.test(name)) return name.replace(/^Gi/i, 'GigabitEthernet');
  if (/^G/i.test(name)) return name.replace(/^G/i, 'GigabitEthernet');
  return name;
}

export interface Services {
  dns: boolean;
  http: boolean;
}

export interface Device {
  id: string;
  kind: DeviceKind;
  name: string;
  powered: boolean;
  ports: Port[];
  /** Hosts only. */
  gateway?: string;
  /** PCs and laptops: the DNS server they ask. */
  dnsServer?: string;
  /** Servers only. */
  services?: Services;
  /** Servers with DNS on: name to IPv4. */
  dnsRecords?: Record<string, string>;
  /** Place on the bench, in scene units. Every device faces +z. */
  x: number;
  z: number;
}

export interface Link {
  id: string;
  a: string;
  b: string;
}

export type Fail = { ok: false; reason: string };
export type Result = { ok: true } | Fail;
export type ResultOf<T> = { ok: true; value: T } | Fail;

export const KIND_LABEL: Record<DeviceKind, string> = {
  pc: 'PC',
  laptop: 'Laptop',
  switch: 'Switch',
  router: 'Router',
  server: 'Server',
};

/** Where a device sits in the Input, Proses, Output story. */
export function roleOf(d: Device): Role {
  if (d.kind === 'pc' || d.kind === 'laptop') return 'input';
  if (d.kind === 'server' && d.services?.http) return 'output';
  return 'process';
}

export const isHost = (d: Device) => d.kind === 'pc' || d.kind === 'laptop' || d.kind === 'server';
export const isClient = (d: Device) => d.kind === 'pc' || d.kind === 'laptop';

/** Port names follow Cisco Packet Tracer: Fa0 on hosts, Fa0/1 to Fa0/24 and Gi0/1 to Gi0/2 on a switch. */
function portNames(kind: DeviceKind): string[] {
  if (kind === 'switch') return [...Array.from({ length: 24 }, (_, i) => `Fa0/${i + 1}`), 'Gi0/1', 'Gi0/2'];
  if (kind === 'router') return ['G0/0', 'G0/1', 'G0/2', 'G0/3'];
  return ['Fa0'];
}

interface DeviceSpec {
  id: string;
  kind: DeviceKind;
  name: string;
  x: number;
  z: number;
  ips?: Record<number, [string, number]>;
  gateway?: string;
  dnsServer?: string;
  services?: Services;
  dnsRecords?: Record<string, string>;
}

export const DEFAULT_RECORDS: Record<string, string> = {
  'www.jaringan.test': '203.0.113.80',
  'jaringan.test': '203.0.113.80',
};

const SPECS: DeviceSpec[] = [
  { id: 'pc', kind: 'laptop', name: 'Laptop', x: -10.9, z: 1.1, ips: { 0: ['192.168.1.10', 24] }, gateway: '192.168.1.1', dnsServer: '172.16.0.53' },
  { id: 'sw', kind: 'switch', name: 'Switch Lab', x: -6.1, z: 1.2 },
  { id: 'dns', kind: 'server', name: 'Server DNS', x: -2.9, z: -3.1, ips: { 0: ['172.16.0.53', 24] }, gateway: '172.16.0.1', services: { dns: true, http: false }, dnsRecords: { ...DEFAULT_RECORDS } },
  { id: 'r1', kind: 'router', name: 'Router Kampus', x: -0.8, z: 1.3, ips: { 0: ['192.168.1.1', 24], 1: ['10.0.12.1', 30], 2: ['10.0.13.1', 30], 3: ['172.16.0.1', 24] } },
  { id: 'r2', kind: 'router', name: 'Router A', x: 2.9, z: -3.0, ips: { 0: ['10.0.12.2', 30], 1: ['10.0.24.1', 30] } },
  { id: 'r3', kind: 'router', name: 'Router B', x: 2.9, z: 5.3, ips: { 0: ['10.0.13.2', 30], 1: ['10.0.34.1', 30] } },
  { id: 'r4', kind: 'router', name: 'Router Pusat Data', x: 6.7, z: 1.3, ips: { 0: ['10.0.24.2', 30], 1: ['10.0.34.2', 30], 2: ['203.0.113.1', 24] } },
  { id: 'web', kind: 'server', name: 'Server Web', x: 10.6, z: 1.1, ips: { 0: ['203.0.113.80', 24] }, gateway: '203.0.113.1', services: { dns: false, http: true } },
];

const DEFAULT_LINKS: [string, string][] = [
  ['pc.0', 'sw.0'],
  ['sw.24', 'r1.0'],
  ['r1.3', 'dns.0'],
  ['r1.1', 'r2.0'],
  ['r1.2', 'r3.0'],
  ['r2.1', 'r4.0'],
  ['r3.1', 'r4.1'],
  ['r4.2', 'web.0'],
];

/** Footprint half sizes, so placement can refuse overlaps before a model exists. */
export const SIZE: Record<DeviceKind, { w: number; d: number }> = {
  pc: { w: 2.6, d: 1.6 },
  laptop: { w: 2.2, d: 1.9 },
  switch: { w: 4.6, d: 1.6 },
  router: { w: 2.8, d: 1.6 },
  server: { w: 1.1, d: 1.6 },
};

export interface SavedDevice extends Omit<Device, 'ports'> {
  ports: Omit<Port, 'deviceId'>[];
}

export interface TopologyData {
  version: 1;
  devices: SavedDevice[];
  links: [string, string][];
}

function validIp(ip: string): boolean {
  return /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(ip);
}

export class Topology {
  readonly devices = new Map<string, Device>();
  readonly links = new Map<string, Link>();
  private portIndex = new Map<string, Port>();
  private portLink = new Map<string, string>();
  private nextLink = 1;
  private nextMac = 0x30;
  /** Goes up on every change; views rebuild when it moves. */
  rev = 0;

  constructor() {
    this.loadDefaults();
  }

  private loadDefaults(): void {
    this.devices.clear();
    this.links.clear();
    this.portIndex.clear();
    this.portLink.clear();
    this.nextLink = 1;
    for (const s of SPECS) {
      const d = this.makeDevice(s.kind, s.id, s.name, s.x, s.z);
      for (const [i, [ip, prefix]] of Object.entries(s.ips ?? {})) Object.assign(d.ports[Number(i)], { ip, prefix });
      d.gateway = s.gateway;
      d.dnsServer = s.dnsServer;
      if (s.services) d.services = { ...s.services };
      if (s.dnsRecords) d.dnsRecords = { ...s.dnsRecords };
      this.insert(d);
    }
    for (const [a, b] of DEFAULT_LINKS) this.connect(a, b);
  }

  private makeDevice(kind: DeviceKind, id: string, name: string, x: number, z: number): Device {
    const base = (this.nextMac++).toString(16).padStart(2, '0');
    const d: Device = {
      id, kind, name, powered: true, x, z,
      ports: portNames(kind).map((n, i) => ({ id: `${id}.${i}`, deviceId: id, name: n, mac: `aa:${base}:00:00:00:${(i + 1).toString(16).padStart(2, '0')}` })),
    };
    if (kind === 'server') {
      d.services = { dns: false, http: true };
      d.dnsRecords = {};
    }
    return d;
  }

  private insert(d: Device): void {
    this.devices.set(d.id, d);
    for (const p of d.ports) this.portIndex.set(p.id, p);
  }

  device(id: string): Device {
    const d = this.devices.get(id);
    if (!d) throw new Error(`Perangkat tidak dikenal: ${id}`);
    return d;
  }

  has(id: string): boolean {
    return this.devices.has(id);
  }

  port(id: string): Port {
    const p = this.portIndex.get(id);
    if (!p) throw new Error(`Port tidak dikenal: ${id}`);
    return p;
  }

  hasPort(id: string): boolean {
    return this.portIndex.has(id);
  }

  deviceOf(portId: string): Device {
    return this.device(this.port(portId).deviceId);
  }

  linkOf(portId: string): Link | undefined {
    const id = this.portLink.get(portId);
    return id ? this.links.get(id) : undefined;
  }

  peer(portId: string): string | undefined {
    const link = this.linkOf(portId);
    if (!link) return undefined;
    return link.a === portId ? link.b : link.a;
  }

  /** A port has carrier when a cable is in it and the devices at both ends are on. */
  carrier(portId: string): boolean {
    const peer = this.peer(portId);
    if (!peer) return false;
    if (this.port(portId).down || this.port(peer).down) return false;
    return this.deviceOf(portId).powered && this.deviceOf(peer).powered;
  }

  /** "shutdown" / "no shutdown" on one port. */
  setPortDown(portId: string, down: boolean): void {
    const p = this.port(portId);
    if (!!p.down === down) return;
    p.down = down || undefined;
    this.rev++;
  }

  portLabel(portId: string): string {
    const p = this.port(portId);
    return `${this.device(p.deviceId).name} ${p.name}`;
  }

  // ------------------------------------------------------------------ devices

  /** Adds a device of `kind` at a spot on the bench. Names count up per kind, like Packet Tracer. */
  addDevice(kind: DeviceKind, x: number, z: number): Device {
    let n = 1;
    const taken = new Set([...this.devices.values()].map((d) => d.name));
    while (taken.has(`${KIND_LABEL[kind]} ${n}`)) n++;
    let id = `${kind}${n}`;
    while (this.devices.has(id)) id = `${kind}${++n}x`;
    const d = this.makeDevice(kind, id, `${KIND_LABEL[kind]} ${n}`, x, z);
    // A router fresh out of the box has every interface shut down until someone enables it.
    if (kind === 'router') for (const p of d.ports) p.down = true;
    this.insert(d);
    this.rev++;
    return d;
  }

  removeDevice(id: string): Device | undefined {
    const d = this.devices.get(id);
    if (!d) return undefined;
    for (const p of d.ports) {
      const l = this.linkOf(p.id);
      if (l) this.disconnect(l.id);
      this.portIndex.delete(p.id);
    }
    this.devices.delete(id);
    this.rev++;
    return d;
  }

  moveDevice(id: string, x: number, z: number): void {
    const d = this.device(id);
    d.x = Math.round(x * 100) / 100;
    d.z = Math.round(z * 100) / 100;
    this.rev++;
  }

  /** Would a device of `kind` at (x, z) sit on top of another one? */
  overlaps(kind: DeviceKind, x: number, z: number, ignore?: string): Device | undefined {
    const s = SIZE[kind];
    for (const d of this.devices.values()) {
      if (d.id === ignore) continue;
      const o = SIZE[d.kind];
      if (Math.abs(d.x - x) < (s.w + o.w) / 2 + 0.3 && Math.abs(d.z - z) < (s.d + o.d) / 2 + 0.3) return d;
    }
    return undefined;
  }

  rename(id: string, name: string): Result {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) return { ok: false, reason: 'Nama tidak boleh kosong.' };
    if (clean.length > 32) return { ok: false, reason: 'Nama paling panjang 32 huruf.' };
    if ([...this.devices.values()].some((d) => d.id !== id && d.name.toLowerCase() === clean.toLowerCase())) {
      return { ok: false, reason: `Nama ${clean} sudah dipakai perangkat lain.` };
    }
    this.device(id).name = clean;
    this.rev++;
    return { ok: true };
  }

  setPower(deviceId: string, on: boolean): void {
    const d = this.device(deviceId);
    if (d.powered === on) return;
    d.powered = on;
    this.rev++;
  }

  // ------------------------------------------------------------------ IP settings

  /** Sets or clears (empty ip) the address on one port, with the checks a student would get wrong. */
  setPortIp(portId: string, ip: string, prefix: number): Result {
    const p = this.port(portId);
    const dev = this.device(p.deviceId);
    if (dev.kind === 'switch') return { ok: false, reason: 'Port switch tidak diberi IP: switch bekerja dengan alamat MAC.' };
    const clean = ip.trim();
    if (!clean) {
      p.ip = undefined;
      p.prefix = undefined;
      this.rev++;
      return { ok: true };
    }
    if (!validIp(clean)) return { ok: false, reason: `${clean} bukan alamat IPv4. Contoh yang benar: 192.168.1.20.` };
    if (!Number.isInteger(prefix) || prefix < 8 || prefix > 30) return { ok: false, reason: 'Prefix harus antara /8 dan /30, misalnya /24.' };
    const n = ipToInt(clean);
    const net = (n & maskOf(prefix)) >>> 0;
    const bcast = (net | (~maskOf(prefix) >>> 0)) >>> 0;
    if (n === net) return { ok: false, reason: `${clean} adalah alamat jaringan ${networkOf(clean, prefix)}, tidak bisa dipakai perangkat.` };
    if (n === bcast) return { ok: false, reason: `${clean} adalah alamat broadcast jaringan ${networkOf(clean, prefix)}, tidak bisa dipakai perangkat.` };
    for (const o of this.portIndex.values()) {
      if (o.id !== portId && o.ip === clean) return { ok: false, reason: `${clean} sudah dipakai ${this.portLabel(o.id)}. Satu IP hanya untuk satu port.` };
    }
    if (dev.kind === 'router') {
      for (const q of dev.ports) {
        if (q.id === portId || !q.ip || q.prefix === undefined) continue;
        const mine = networkOf(clean, prefix);
        const theirs = networkOf(q.ip, q.prefix);
        if (inNetwork(q.ip, mine) || inNetwork(clean, theirs)) {
          return { ok: false, reason: `Jaringan ${mine} bertumpuk dengan ${theirs} di port ${q.name}. Tiap port router harus di jaringan yang berbeda.` };
        }
      }
    }
    p.ip = clean;
    p.prefix = prefix;
    this.rev++;
    return { ok: true };
  }

  setHostField(id: string, field: 'gateway' | 'dnsServer', ip: string): Result {
    const d = this.device(id);
    const clean = ip.trim();
    if (clean && !validIp(clean)) return { ok: false, reason: `${clean} bukan alamat IPv4.` };
    d[field] = clean || undefined;
    this.rev++;
    return { ok: true };
  }

  setServices(id: string, services: Services): void {
    const d = this.device(id);
    d.services = { ...services };
    d.dnsRecords ??= {};
    this.rev++;
  }

  setDnsRecord(id: string, name: string, ip: string): Result {
    const d = this.device(id);
    const host = name.trim().toLowerCase().replace(/\.$/, '');
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return { ok: false, reason: 'Nama harus seperti www.contoh.test: huruf, angka, minus, dipisah titik.' };
    if (!validIp(ip.trim())) return { ok: false, reason: `${ip} bukan alamat IPv4.` };
    d.dnsRecords = { ...(d.dnsRecords ?? {}), [host]: ip.trim() };
    this.rev++;
    return { ok: true };
  }

  removeDnsRecord(id: string, name: string): void {
    const d = this.device(id);
    if (!d.dnsRecords) return;
    const next = { ...d.dnsRecords };
    delete next[name];
    d.dnsRecords = next;
    this.rev++;
  }

  /**
   * Hands a host an address the way a DHCP server would: the first free IP in the network of
   * the router port it can reach, that router port as gateway, and the first DNS server found.
   */
  autoAddress(id: string): ResultOf<string> {
    const d = this.device(id);
    const nic = d.ports[0];
    if (!this.linkOf(nic.id)) return { ok: false, reason: `${d.name} belum berkabel. Pasang kabel ke switch atau router dulu.` };
    const seg = this.segments();
    const mine = seg.get(nic.id);
    if (mine === undefined) return { ok: false, reason: `${d.name} sedang mati.` };
    const gw = [...seg].map(([pid, s]) => (s === mine ? this.port(pid) : undefined))
      .find((p) => p && p.ip && p.prefix !== undefined && this.deviceOf(p.id).kind === 'router');
    if (!gw?.ip || gw.prefix === undefined) {
      return { ok: false, reason: 'Tidak ada port router ber-IP di jaringan yang sama. Pastikan kabelnya sampai ke router, dan port router itu sudah diberi IP.' };
    }
    const used = new Set([...this.portIndex.values()].map((p) => p.ip).filter(Boolean));
    const net = (ipToInt(gw.ip) & maskOf(gw.prefix)) >>> 0;
    const size = 2 ** (32 - gw.prefix);
    let pick: string | undefined;
    for (let i = 10; i < size - 1 && !pick; i++) {
      const cand = [(net + i) >>> 24 & 255, (net + i) >>> 16 & 255, (net + i) >>> 8 & 255, (net + i) & 255].join('.');
      if (!used.has(cand)) pick = cand;
    }
    for (let i = 2; i < Math.min(10, size - 1) && !pick; i++) {
      const cand = [(net + i) >>> 24 & 255, (net + i) >>> 16 & 255, (net + i) >>> 8 & 255, (net + i) & 255].join('.');
      if (!used.has(cand)) pick = cand;
    }
    if (!pick) return { ok: false, reason: `Jaringan ${networkOf(gw.ip, gw.prefix)} sudah penuh.` };
    nic.ip = pick;
    nic.prefix = gw.prefix;
    d.gateway = gw.ip;
    if (isClient(d)) {
      const dns = [...this.devices.values()].find((x) => x.kind === 'server' && x.services?.dns && x.ports[0].ip);
      d.dnsServer = dns?.ports[0].ip ?? d.dnsServer;
    }
    this.rev++;
    return { ok: true, value: `${pick}/${gw.prefix}, gateway ${gw.ip}${isClient(d) && d.dnsServer ? `, DNS ${d.dnsServer}` : ''}` };
  }

  // ------------------------------------------------------------------ cables

  connect(a: string, b: string): ResultOf<Link> {
    if (a === b) return { ok: false, reason: 'Pilih port lain: ujung kabel tidak bisa masuk ke port yang sama.' };
    const pa = this.port(a);
    const pb = this.port(b);
    if (pa.deviceId === pb.deviceId) {
      return { ok: false, reason: `Kedua port ada di ${this.device(pa.deviceId).name}. Kabel harus menghubungkan dua perangkat.` };
    }
