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
