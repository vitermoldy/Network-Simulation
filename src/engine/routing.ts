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
    }
    attached.set(r.id, list);
  }

  // Two routers are neighbours when they have ports in one broadcast domain and one subnet.
  const edges = new Map<string, Edge[]>();
  for (const r of routers) {
    const list: Edge[] = [];
    for (const p of r.ports) {
      if (!p.ip || p.prefix === undefined || !topo.carrier(p.id)) continue;
      const s = seg.get(p.id);
      for (const o of routers) {
        if (o.id === r.id) continue;
        for (const q of o.ports) {
          if (!q.ip || q.prefix === undefined || seg.get(q.id) !== s) continue;
          if (networkOf(q.ip, q.prefix) !== networkOf(p.ip, p.prefix)) continue;
          list.push({ to: o.id, portId: p.id, nextHop: q.ip });
        }
      }
    }
    list.sort((a, b) => a.to.localeCompare(b.to));
    edges.set(r.id, list);
  }

  const tables = new Map<string, Route[]>();
  for (const r of routers) {
    // Dijkstra with unit costs; the first hop rides along with each distance.
    const dist = new Map<string, number>([[r.id, 0]]);
    const first = new Map<string, Edge>();
    const done = new Set<string>();
    while (true) {
      let cur: string | undefined;
      for (const [id, d] of dist) {
        if (done.has(id)) continue;
        if (cur === undefined || d < dist.get(cur)! || (d === dist.get(cur)! && id < cur)) cur = id;
      }
      if (cur === undefined) break;
      done.add(cur);
      for (const e of edges.get(cur) ?? []) {
        const nd = dist.get(cur)! + 1;
