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
