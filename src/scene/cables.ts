// Patch cables: an RJ45 plug sits in each socket, the cable leaves along the port's facing,
// drops to the bench, and runs around any device in its way to the other socket.

import * as THREE from 'three';
import type { PortView } from './devices';
import { MATERIAL } from './theme';

export interface Box2 {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

type V2 = [number, number];

const FLOOR_Y = 0.045;
const MARGIN = 0.28;

function segmentHitsBox(a: V2, b: V2, box: Box2): boolean {
  // Slab test on the segment a..b.
  let t0 = 0;
  let t1 = 1;
  const d = [b[0] - a[0], b[1] - a[1]];
  const lo = [box.x0, box.z0];
  const hi = [box.x1, box.z1];
  for (let i = 0; i < 2; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (a[i] < lo[i] || a[i] > hi[i]) return false;
    } else {
      let ta = (lo[i] - a[i]) / d[i];
      let tb = (hi[i] - a[i]) / d[i];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
  }
  return true;
}

const inside = (p: V2, b: Box2) => p[0] > b.x0 && p[0] < b.x1 && p[1] > b.z0 && p[1] < b.z1;
const dist = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Shortest of: straight, one corner, two corners, around the expanded device boxes. */
export function planFloorPath(a: V2, b: V2, devices: Box2[]): V2[] {
  const boxes = devices.map((d) => ({ x0: d.x0 - MARGIN, x1: d.x1 + MARGIN, z0: d.z0 - MARGIN, z1: d.z1 + MARGIN }));
  const free = boxes.filter((bx) => !inside(a, bx) && !inside(b, bx));
  const clear = (p: V2, q: V2) => !free.some((bx) => segmentHitsBox(p, q, bx));
  if (clear(a, b)) return [a, b];
  const pad = 0.16;
  const corners: V2[] = [];
  for (const bx of free) {
    for (const c of [[bx.x0 - pad, bx.z0 - pad], [bx.x1 + pad, bx.z0 - pad], [bx.x0 - pad, bx.z1 + pad], [bx.x1 + pad, bx.z1 + pad]] as V2[]) {
      if (!boxes.some((o) => inside(c, o))) corners.push(c);
    }
  }
  let best: V2[] | undefined;
  let bestLen = Infinity;
  for (const c of corners) {
    if (clear(a, c) && clear(c, b)) {
      const len = dist(a, c) + dist(c, b);
      if (len < bestLen) {
        bestLen = len;
        best = [a, c, b];
      }
    }
