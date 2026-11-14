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
  draw({ ctx, px, scale, text });
  return canvasTexture(c);
}

export function keyboardTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(1024, 420);
  ctx.fillStyle = '#c9ced5';
  ctx.fillRect(0, 0, 1024, 420);
  // A clear band above the keys holds the power key and its label.
  ctx.fillStyle = '#25282d';
  ctx.beginPath();
  ctx.roundRect(70, 92, 884, 226, 14);
  ctx.fill();
  const rows = [14, 14, 13, 12];
  rows.forEach((n, r) => {
    const kw = 860 / 14;
    const off = (14 - n) * kw / 2;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = '#3a3e45';
      ctx.beginPath();
      ctx.roundRect(82 + off + i * kw, 102 + r * 53, kw - 8, 44, 6);
      ctx.fill();
    }
  });
  ctx.fillStyle = '#bfc4cb';
  ctx.strokeStyle = '#aeb3ba';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(392, 332, 240, 76, 12);
  ctx.fill();
  ctx.stroke();
  return canvasTexture(c);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

export const SCREEN_W = 960;
export const SCREEN_H = 600;

/** Draws what the laptop's browser shows. The page appears part by part as TCP delivers it. */
export function drawBrowser(ctx: CanvasRenderingContext2D, view: BrowserView): void {
  const W = SCREEN_W;
  const H = SCREEN_H;
  if (view.state === 'off') {
    ctx.fillStyle = '#060708';
    ctx.fillRect(0, 0, W, H);
    return;
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  // Toolbar with the address.
