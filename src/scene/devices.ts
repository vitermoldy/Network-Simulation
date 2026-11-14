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
