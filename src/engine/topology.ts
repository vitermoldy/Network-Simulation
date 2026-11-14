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
