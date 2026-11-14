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
  ctx.fillStyle = '#e4e7eb';
  ctx.fillRect(0, 0, W, 78);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(24, 16, W - 48, 46, 23);
  ctx.fill();
  ctx.fillStyle = '#5d6470';
  ctx.font = `500 22px ${FONT_MONO}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(`http://${view.url}/`, 50, 40);
  const busy = view.state === 'resolving' || view.state === 'connecting' || view.state === 'loading';
  if (busy) {
    const done = view.parts.filter(Boolean).length;
    const frac = view.state === 'resolving' ? 0.15 : view.state === 'connecting' ? 0.35 : 0.45 + 0.55 * (done / view.parts.length);
    ctx.fillStyle = '#1f2de6';
    ctx.fillRect(0, 74, W * frac, 4);
  }

  const body = (y: number) => y + 78;
  ctx.textAlign = 'left';
  if (view.state === 'idle') {
    ctx.fillStyle = '#5d6470';
    ctx.font = `500 30px ${FONT_TEXT}`;
    ctx.textAlign = 'center';
    ctx.fillText('Ketik alamat, lalu tekan', W / 2, body(220));
    ctx.fillText('Kirim permintaan', W / 2, body(262));
    return;
  }
  if (view.state === 'error') {
    ctx.fillStyle = '#0b0c0e';
    ctx.font = `600 40px ${FONT_TEXT}`;
    ctx.fillText('Halaman tidak bisa dibuka', 56, body(96));
    ctx.fillStyle = '#5d6470';
    ctx.font = `400 26px ${FONT_TEXT}`;
    wrap(ctx, view.message ?? '', W - 112).slice(0, 7).forEach((l, i) => ctx.fillText(l, 56, body(160 + i * 38)));
    return;
  }
  if (view.state === 'resolving' || view.state === 'connecting') {
    ctx.fillStyle = '#5d6470';
    ctx.font = `500 30px ${FONT_TEXT}`;
    ctx.textAlign = 'center';
    ctx.fillText(view.message ?? '', W / 2, body(240));
    return;
  }
  // loading or done: draw the page, leaving gaps where a segment has not arrived in order.
  const [header, main, footer] = view.parts;
  if (header) {
    ctx.fillStyle = '#1f2de6';
    ctx.fillRect(0, body(0), W, 84);
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 30px ${FONT_TEXT}`;
    ctx.fillText('jaringan.test', 48, body(42));
  } else placeholder(ctx, 0, body(0), W, 84, 1);
  if (main) {
    ctx.fillStyle = '#0b0c0e';
    ctx.font = `600 50px ${FONT_TEXT}`;
    ctx.fillText('Halo dari Server Web', 48, body(160));
    ctx.fillStyle = '#3b4048';
    ctx.font = `400 27px ${FONT_TEXT}`;
    wrap(ctx, 'Halaman ini dikirim server web lewat switch dan router sampai ke layarmu, potong demi potong.', W - 96)
      .forEach((l, i) => ctx.fillText(l, 48, body(226 + i * 40)));
  } else placeholder(ctx, 48, body(118), W - 96, 170, 2);
  if (footer) {
    ctx.fillStyle = '#e4e7eb';
    ctx.fillRect(0, H - 76, W, 76);
    ctx.fillStyle = '#5d6470';
    ctx.font = `500 24px ${FONT_TEXT}`;
    ctx.fillText(`Dikirim dalam ${PAGE_PARTS.length} segmen TCP`, 48, H - 38);
  } else placeholder(ctx, 0, H - 76, W, 76, 3);
}

