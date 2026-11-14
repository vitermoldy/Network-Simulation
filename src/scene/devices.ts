// Procedural models of the devices on the bench, shaped after the gear students meet in Cisco
// labs and Packet Tracer: a Catalyst-style access switch (24 FastEthernet ports in blocks of
// eight, two Gigabit uplinks), an ISR-style router (black bezel, module slots, console port),
// tower PCs and servers, and a laptop. No maker's logo or name is printed on them.
// Every port is a real socket (metal frame, dark hole, gold pins) with its own LED, and every
// device has a power control you can press, placed on the front so it is easy to find.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Device } from '../engine/topology';
import type { Simulator } from '../engine/sim';
import { canvasTexture, drawBrowser, drawDesktop, keyboardTexture, makeCanvas, printFace, SCREEN_H, SCREEN_W, type FacePrinter } from './textures';
import { MATERIAL } from './theme';

export type Pick =
  | { type: 'port'; portId: string }
  | { type: 'power'; deviceId: string }
  | { type: 'device'; deviceId: string }
  | { type: 'cable'; linkId: string }
  | { type: 'packet'; packetId: number };

export interface PortView {
  id: string;
  deviceId: string;
  anchor: THREE.Object3D;
  frameMat: THREE.MeshStandardMaterial;
  frameColor: number;
  link: THREE.Mesh;
  /** Missing on switch ports: Cisco switches use one LED per port for link and activity. */
  act?: THREE.Mesh;
  hit: THREE.Mesh;
  holeW: number;
  holeH: number;
}

export interface DeviceView {
  device: Device;
  group: THREE.Group;
  height: number;
  ports: Map<string, PortView>;
  powerHit: THREE.Mesh;
  powerGlow: THREE.MeshStandardMaterial;
  rocker?: THREE.Object3D;
  button?: THREE.Object3D;
  powerLeds: THREE.Mesh[];
  /** Extra LEDs that blink with any traffic (SYST, ACT, HDD). */
  busyLeds: THREE.Mesh[];
  hits: THREE.Mesh[];
  tagAnchor: THREE.Object3D;
  topLocal: THREE.Vector3;
  half: { x: number; z0: number; z1: number };
  screen?: { ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture; key: string };
  /** What the model was built from; a change rebuilds it. */
  signature: string;
}

const std = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.05, ...extra });

const shared = {
  slate: std(MATERIAL.slate, { roughness: 0.55, metalness: 0.2 }),
  graphite: std(MATERIAL.graphite, { roughness: 0.5, metalness: 0.25 }),
  laptop: std(MATERIAL.laptop, { roughness: 0.45, metalness: 0.25 }),
  tower: std(MATERIAL.tower),
  server: std(MATERIAL.server),
  bezel: std(MATERIAL.bezel, { roughness: 0.5 }),
  hole: new THREE.MeshStandardMaterial({ color: MATERIAL.hole, roughness: 0.95 }),
  pin: std(MATERIAL.pin, { metalness: 0.9, roughness: 0.3 }),
  rocker: std(MATERIAL.rocker, { roughness: 0.4 }),
  plate: std(MATERIAL.plate, { metalness: 0.6, roughness: 0.35 }),
  screw: std(0x6c737c, { metalness: 0.8, roughness: 0.3 }),
  invisible: new THREE.MeshBasicMaterial({ visible: false }),
};

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

function hitBox(w: number, h: number, d: number, pick: Pick): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), shared.invisible);
  m.userData.pick = pick;
  return m;
}

export function ledMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: MATERIAL.ledOff, emissive: 0x000000, roughness: 0.3 });
}

export function setLed(m: THREE.Mesh, color: number | null): void {
  const key = color ?? -1;
  if (m.userData.led === key) return;
  m.userData.led = key;
  const mat = m.material as THREE.MeshStandardMaterial;
  if (color === null) {
    mat.color.setHex(MATERIAL.ledOff);
    mat.emissive.setHex(0x000000);
    mat.emissiveIntensity = 0;
  } else {
    mat.color.setHex(color);
    mat.emissive.setHex(color);
    mat.emissiveIntensity = 1.9;
  }
}

function led(r = 0.022): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r, r, 0.022, 14);
  g.rotateX(Math.PI / 2);
  return mesh(g, ledMaterial(), false);
}

/** An RJ45 socket. Local +z points out of the device. `flip` puts the latch slot on top. */
function buildPort(portId: string, holeW: number, holeH: number, frameColor: number, flip = false) {
  const group = new THREE.Group();
  const t = 0.02;
  const frameMat = std(frameColor, { metalness: 0.7, roughness: 0.32 });
  const bars: [number, number, number, number][] = [
    [0, holeH / 2 + t / 2, holeW + 2 * t, t],
    [0, -holeH / 2 - t / 2, holeW + 2 * t, t],
    [-holeW / 2 - t / 2, 0, t, holeH],
    [holeW / 2 + t / 2, 0, t, holeH],
  ];
  for (const [x, y, w, h] of bars) {
    const b = mesh(new THREE.BoxGeometry(w, h, 0.03), frameMat, false);
    b.position.set(x, y, 0.015);
    group.add(b);
  }
  const hole = mesh(new THREE.BoxGeometry(holeW, holeH, 0.02), shared.hole, false);
  hole.position.z = -0.006;
  group.add(hole);
  const s = flip ? -1 : 1;
  for (let i = 0; i < 8; i++) {
    const pin = mesh(new THREE.BoxGeometry(holeW * 0.045, holeH * 0.3, 0.004), shared.pin, false);
    pin.position.set(-holeW * 0.35 + (i * holeW * 0.7) / 7, s * holeH * 0.3, 0.006);
    group.add(pin);
  }
  const slot = mesh(new THREE.BoxGeometry(holeW * 0.38, holeH * 0.16, 0.004), std(0x1a1c20), false);
  slot.position.set(0, -s * holeH * 0.36, 0.006);
  group.add(slot);
  const hit = hitBox(holeW + 0.06, holeH + 0.06, 0.1, { type: 'port', portId });
  hit.position.z = 0.03;
  group.add(hit);
  const anchor = new THREE.Object3D();
  group.add(anchor);
  return { group, anchor, frameMat, hit };
}

let rockerTex: THREE.CanvasTexture | undefined;
function rockerTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64, 96);
  ctx.fillStyle = '#1b1d21';
  ctx.fillRect(0, 0, 64, 96);
  ctx.fillStyle = '#f2f3f5';
  ctx.fillRect(29, 12, 6, 26);
  ctx.strokeStyle = '#f2f3f5';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(32, 70, 11, 0, Math.PI * 2);
  ctx.stroke();
  return canvasTexture(c);
}

/** A rocker switch: I (on) at the top, O (off) at the bottom. */
function buildRocker(deviceId: string, scale = 1) {
  const group = new THREE.Group();
  const housing = mesh(new THREE.BoxGeometry(0.2 * scale, 0.27 * scale, 0.03), shared.rocker, false);
  housing.position.z = 0.015;
  group.add(housing);
  rockerTex ??= rockerTexture();
  const glow = std(MATERIAL.rocker, { roughness: 0.35 });
  const face = new THREE.MeshStandardMaterial({ map: rockerTex, roughness: 0.4 });
  const paddle = new THREE.Group();
  paddle.add(mesh(new THREE.BoxGeometry(0.15 * scale, 0.22 * scale, 0.05), [glow, glow, glow, glow, face, glow], false));
  paddle.position.z = 0.04;
  group.add(paddle);
  const hit = hitBox(0.3 * scale, 0.36 * scale, 0.14, { type: 'power', deviceId });
  hit.position.z = 0.05;
  group.add(hit);
  return { group, paddle, hit, glow };
}

/** A round push button with a light ring. Local +z points out. */
function buildRoundButton(deviceId: string, r = 0.075) {
  const group = new THREE.Group();
  const seat = mesh(new THREE.CylinderGeometry(r * 1.45, r * 1.45, 0.016, 32).rotateX(Math.PI / 2), shared.bezel, false);
  seat.position.z = 0.008;
  group.add(seat);
  const ring = mesh(new THREE.TorusGeometry(r * 1.18, r * 0.16, 10, 40), ledMaterial(), false);
  ring.position.z = 0.018;
  group.add(ring);
  const glow = std(0x2f3237, { roughness: 0.35 });
  const button = new THREE.Group();
  button.add(mesh(new THREE.CylinderGeometry(r, r, 0.04, 32).rotateX(Math.PI / 2), glow, false));
  const [c, ctx] = makeCanvas(96, 96);
  ctx.strokeStyle = '#e9ecef';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(48, 52, 24, -Math.PI * 0.32, Math.PI * 1.32);
  ctx.moveTo(48, 18);
  ctx.lineTo(48, 50);
  ctx.stroke();
  const symbol = new THREE.Mesh(new THREE.CircleGeometry(r * 0.8, 24), new THREE.MeshBasicMaterial({ map: canvasTexture(c), transparent: true }));
  symbol.position.z = 0.0205;
  button.add(symbol);
  button.position.z = 0.03;
  group.add(button);
  const hit = hitBox(r * 3.6, r * 3.6, 0.14, { type: 'power', deviceId });
  hit.position.z = 0.05;
  group.add(hit);
  return { group, button, ring, hit, glow };
}

const rounded = (w: number, h: number, d: number, mat: THREE.Material, r = 0.04) => mesh(new RoundedBoxGeometry(w, h, d, 3, r), mat);

/** An opaque printed front panel: background colours, labels, vents. */
function frontPanel(w: number, h: number, draw: (p: FacePrinter) => void): THREE.Mesh {
  const tex = printFace(w, h, draw);
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.1 }));
}

interface Build {
  group: THREE.Group;
  height: number;
  ports: PortView[];
  power: { hit: THREE.Mesh; glow: THREE.MeshStandardMaterial; rocker?: THREE.Object3D; button?: THREE.Object3D; leds: THREE.Mesh[] };
  busy: THREE.Mesh[];
  hits: THREE.Mesh[];
  tagY: number;
  top: THREE.Vector3;
  half: { x: number; z0: number; z1: number };
  screen?: DeviceView['screen'];
}

function newBuild(group: THREE.Group, w: number, h: number, d: number, body: THREE.Mesh): Build {
  return {
    group, height: h, ports: [], busy: [], hits: [body], tagY: h + 0.45, top: new THREE.Vector3(0, h + 0.15, 0),
    power: { hit: body, glow: shared.slate, leds: [] }, half: { x: w / 2, z0: -d / 2, z1: d / 2 },
  };
}

function addPort(b: Build, dev: Device, index: number, x: number, y: number, z: number, o: { w: number; h: number; frame?: number; flip?: boolean; ledY?: number; act?: boolean }): void {
  const port = dev.ports[index];
  const frameColor = o.frame ?? MATERIAL.metal;
  const p = buildPort(port.id, o.w, o.h, frameColor, o.flip);
  p.group.position.set(x, y, z);
  b.group.add(p.group);
  const link = led(0.02);
  const ledY = o.ledY ?? y - o.h / 2 - 0.055;
  if (o.act === false) {
    link.position.set(x, ledY, z + 0.012);
    b.group.add(link);
    b.ports.push({ id: port.id, deviceId: dev.id, anchor: p.anchor, frameMat: p.frameMat, frameColor, hit: p.hit, holeW: o.w, holeH: o.h, link });
    return;
  }
  const act = led(0.02);
  link.position.set(x - o.w * 0.3, ledY, z + 0.012);
  act.position.set(x + o.w * 0.3, ledY, z + 0.012);
  b.group.add(link, act);
  b.ports.push({ id: port.id, deviceId: dev.id, anchor: p.anchor, frameMat: p.frameMat, frameColor, hit: p.hit, holeW: o.w, holeH: o.h, link, act });
}

/** Catalyst-style access switch: steel-blue system panel, 24 ports in three blocks, two uplinks. */
function buildSwitch(dev: Device): Build {
  const w = 4.4;
  const h = 0.5;
  const d = 1.5;
  const group = new THREE.Group();
  const body = rounded(w, h, d, shared.slate, 0.03);
  body.position.y = h / 2;
  body.userData.pick = { type: 'device', deviceId: dev.id } satisfies Pick;
  group.add(body);
  const b = newBuild(group, w, h, d, body);
  const z = d / 2 + 0.006;
  const sysEnd = -w / 2 + 1.05;
  const holeW = 0.15;
  const holeH = 0.115;
  const colX = (i: number) => {
    const block = Math.floor(i / 8);
    const col = Math.floor((i % 8) / 2);
    return -0.95 + block * 0.86 + col * 0.19;
  };
  const rowY = (i: number) => (i % 2 === 0 ? 0.335 : 0.165);

  const panel = frontPanel(w, h, (p) => {
    const [x0] = p.px(-w / 2, 0);
    const [x1] = p.px(sysEnd, 0);
    const [x2] = p.px(w / 2, 0);
    p.ctx.fillStyle = '#8b9aaa';
    p.ctx.fillRect(x0, 0, x1 - x0, h * p.scale);
    p.ctx.fillStyle = '#23272c';
    p.ctx.fillRect(x1, 0, x2 - x1, h * p.scale);
    p.text('SWITCH 24 PORT', -w / 2 + 0.5, 0.06, 0.04, { color: '#2a3038', weight: 650 });
    p.text('POWER', -w / 2 + 0.17, 0.06, 0.03, { color: '#2a3038' });
    for (const [i, s] of ['SYST', 'STAT', 'DUPLX', 'SPEED'].entries()) p.text(s, -w / 2 + 0.47 + i * 0.13, 0.4, 0.026, { color: '#2a3038', weight: 600 });
    p.text('MODE', -w / 2 + 0.88, 0.2, 0.026, { color: '#2a3038' });
    for (let i = 0; i < 24; i++) {
      const top = i % 2 === 0;
      p.text(String(i + 1), colX(i) + 0.05, top ? 0.452 : 0.048, 0.03, { color: '#c9d0d8', mono: true, weight: 500 });
    }
    for (let blk = 0; blk < 3; blk++) {
      const [bx0, by] = p.px(-0.95 + blk * 0.86 - 0.1, 0.25);
      p.ctx.fillStyle = 'rgba(201,208,216,0.18)';
      p.ctx.fillRect(bx0, by - 0.002 * p.scale, 0.006 * p.scale, 0.004 * p.scale);
    }
    p.text('Gi0/1', 1.8, 0.42, 0.03, { color: '#c9d0d8', mono: true, weight: 500 });
    p.text('Gi0/2', 2.04, 0.42, 0.03, { color: '#c9d0d8', mono: true, weight: 500 });
    p.text('10/100', 0.35, 0.25, 0.022, { color: 'rgba(201,208,216,0.55)', weight: 500 });
  });
  panel.position.set(0, h / 2, d / 2 + 0.002);
  group.add(panel);

  for (let i = 0; i < 24; i++) {
