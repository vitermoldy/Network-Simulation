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
