// Canvas-drawn textures: the printing on device faces, the laptop screen, the floor zone labels.

import * as THREE from 'three';
import type { BrowserView } from '../engine/sim';
import { PAGE_PARTS } from '../engine/sim';

export const FONT_TEXT = '"Host Grotesk Variable", "Host Grotesk", system-ui, sans-serif';
export const FONT_MONO = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace';

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

export function canvasTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export interface FacePrinter {
  ctx: CanvasRenderingContext2D;
  /** Face coordinates (x from the centre, y from the bottom, in scene units) to canvas pixels. */
  px: (x: number, y: number) => [number, number];
