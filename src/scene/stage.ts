// The 3D bench: a camera you can turn, the Input, Proses and Output zones on the floor, the devices,
// the cables, and the packets riding on them. Clicks on a power control, a port, a cable or a packet
// go back to the app as picks; placing and dragging devices go back as place and move requests.
// The app decides what each of them does.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Packet } from '../engine/packet';
import type { Simulator } from '../engine/sim';
import { roleOf, type DeviceKind, type Role } from '../engine/topology';
import { buildPlug, cableCurve, cableMaterial, danglingCurve, tube, type Box2 } from './cables';
import { buildDevice, buildGhost, footprintOf, refreshLive, signatureOf, type DeviceView, type Pick, type PortView } from './devices';
import { canvasTexture, drawArrow, drawZoneLabel, makeCanvas } from './textures';
import { MATERIAL, SCENE_THEMES, type SceneTheme, type ThemeName } from './theme';

export interface StageEvents {
  pick: (p: Pick | null) => void;
  hover: (p: Pick | null, x: number, y: number) => void;
  place: (kind: DeviceKind, x: number, z: number) => void;
  /** Returns false to send the device back where it was. */
  move: (deviceId: string, x: number, z: number) => boolean;
}

interface CableView {
  linkId: string;
  a: string;
  b: string;
  group: THREE.Group;
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  curve: THREE.CatmullRomCurve3;
}

interface PacketView {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  tag: CSS2DObject;
  el: HTMLElement;
  last: THREE.Vector3;
}

interface ZoneView {
  role: Role;
  group: THREE.Group;
  edge: THREE.MeshBasicMaterial;
}

const ZONE_TEXT: Record<Role, [string, string]> = {
  input: ['INPUT', 'Alamat diketik di sini'],
  process: ['PROSES', 'Paket diteruskan'],
  output: ['OUTPUT', 'Jawaban disiapkan'],
};

const packetGeo = new RoundedBoxGeometry(0.32, 0.2, 0.2, 2, 0.05);
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

function roundedRectShape(x0: number, z0: number, x1: number, z1: number, r: number): THREE.Shape {
  // Drawn in the XY plane with y = -z, then laid flat.
  const s = new THREE.Shape();
  s.moveTo(x0 + r, -z0);
  s.lineTo(x1 - r, -z0);
  s.quadraticCurveTo(x1, -z0, x1, -z0 - r);
  s.lineTo(x1, -z1 + r);
  s.quadraticCurveTo(x1, -z1, x1 - r, -z1);
  s.lineTo(x0 + r, -z1);
  s.quadraticCurveTo(x0, -z1, x0, -z1 + r);
  s.lineTo(x0, -z0 - r);
  s.quadraticCurveTo(x0, -z0, x0 + r, -z0);
  return s;
}

function outlineGeometry(x0: number, z0: number, x1: number, z1: number, r: number, t: number): THREE.ShapeGeometry {
  const outer = roundedRectShape(x0, z0, x1, z1, r);
  const inner = roundedRectShape(x0 + t, z0 + t, x1 - t, z1 - t, Math.max(0.01, r - t));
  outer.holes.push(new THREE.Path(inner.getPoints(8).reverse()));
  const g = new THREE.ShapeGeometry(outer, 8);
  g.rotateX(-Math.PI / 2);
  return g;
}

function disposeTree(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry && m.geometry !== packetGeo) m.geometry.dispose();
  });
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly labels: CSS2DRenderer;
