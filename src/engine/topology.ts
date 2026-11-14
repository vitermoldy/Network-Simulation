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
