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
  scale: number;
  text: (s: string, x: number, y: number, size: number, opts?: { color?: string; align?: CanvasTextAlign; mono?: boolean; weight?: number }) => void;
}

/** A transparent texture laid over a device face for its printed labels. */
export function printFace(w: number, h: number, draw: (p: FacePrinter) => void): THREE.CanvasTexture {
  const scale = Math.min(420, 1600 / w);
  const [c, ctx] = makeCanvas(Math.round(w * scale), Math.round(h * scale));
  const px = (x: number, y: number): [number, number] => [(x + w / 2) * scale, (h - y) * scale];
  const text: FacePrinter['text'] = (s, x, y, size, opts = {}) => {
    const [cx, cy] = px(x, y);
    ctx.fillStyle = opts.color ?? '#2a2e35';
    ctx.textAlign = opts.align ?? 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${opts.weight ?? 600} ${Math.round(size * scale)}px ${opts.mono ? FONT_MONO : FONT_TEXT}`;
    ctx.fillText(s, cx, cy);
  };
