// Link-state routing, in the spirit of OSPF: every router that is on learns the whole map of
// routers it can reach, runs Dijkstra from itself, and keeps the shortest way to every network.

import { inNetwork, networkOf, prefixOf } from './ip';
import type { Topology } from './topology';

export interface Route {
  network: string;
  /** C = connected on one of my ports, O = learned from another router. */
  type: 'C' | 'O';
  portId: string;
  nextHop?: string;
  /** The router the next hop belongs to, for the explanation text. */
  viaRouter?: string;
  cost: number;
}

interface Edge {
  to: string;
  portId: string;
  nextHop: string;
}

export function computeRoutes(topo: Topology): Map<string, Route[]> {
  const seg = topo.segments();
  const routers = [...topo.devices.values()].filter((d) => d.kind === 'router' && d.powered);

  // Networks each router has up on its own ports.
  const attached = new Map<string, { network: string; portId: string }[]>();
  for (const r of routers) {
    const list: { network: string; portId: string }[] = [];
    for (const p of r.ports) {
      if (p.ip && p.prefix !== undefined && topo.carrier(p.id)) list.push({ network: networkOf(p.ip, p.prefix), portId: p.id });
