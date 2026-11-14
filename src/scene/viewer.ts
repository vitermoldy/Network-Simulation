// The close-up in a device's window (the "Fisik" tab): one device alone on a small turntable,
// big enough to read every port, LED and label. It follows the live network like the bench does,
// and its power control works here too. Plugged cables show as short leads leaving the sockets.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Simulator } from '../engine/sim';
import { buildPlug, cableMaterial, tube } from './cables';
import { buildDevice, refreshLive, signatureOf, type DeviceView, type Pick } from './devices';
import { SCENE_THEMES, type ThemeName } from './theme';

export class DeviceViewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
  private controls: OrbitControls;
  private view?: DeviceView;
  private leads = new THREE.Group();
  private floorMat = new THREE.MeshStandardMaterial({ color: 0xe2e5ea, roughness: 0.95 });
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private home?: { target: THREE.Vector3; position: THREE.Vector3 };
  private key = '';
  private down?: { x: number; y: number };
  private observer: ResizeObserver;
  deviceId = '';
  active = false;

  constructor(private host: HTMLElement, private sim: Simulator, private events: { power: (id: string) => void; hover: (text: string) => void }) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    const canvas = this.renderer.domElement;
    canvas.className = 'viewer-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    host.appendChild(canvas);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.maxPolarAngle = 1.5;
    this.controls.minDistance = 0.8;
    this.controls.maxDistance = 14;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc4c9d0, 1.5));
