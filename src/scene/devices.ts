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
