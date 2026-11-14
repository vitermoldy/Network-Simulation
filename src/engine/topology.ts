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
