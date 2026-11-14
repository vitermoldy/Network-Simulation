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
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 6, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -4;
    key.shadow.camera.right = 4;
    key.shadow.camera.top = 4;
    key.shadow.camera.bottom = -4;
    key.shadow.radius = 5;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(-4, 3, 6);
    this.scene.add(fill);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.scene.add(this.leads);

    canvas.addEventListener('pointerdown', (e) => {
      this.down = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = undefined;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
      const pick = this.cast(e);
      if (pick?.type === 'power') this.events.power(pick.deviceId);
    });
    canvas.addEventListener('pointermove', (e) => {
      const pick = this.cast(e);
      canvas.style.cursor = pick?.type === 'power' ? 'pointer' : 'grab';
      this.events.hover(this.describe(pick));
    });
    canvas.addEventListener('pointerleave', () => this.events.hover(''));
    canvas.addEventListener('keydown', (e) => {
      if (e.key === '+' || e.key === '=') this.zoom(0.8);
      else if (e.key === '-') this.zoom(1.25);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const off = this.camera.position.clone().sub(this.controls.target);
        off.applyAxisAngle(new THREE.Vector3(0, 1, 0), e.key === 'ArrowLeft' ? -0.25 : 0.25);
        this.camera.position.copy(this.controls.target).add(off);
      } else return;
      e.preventDefault();
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
  }

  setTheme(name: ThemeName): void {
    const t = SCENE_THEMES[name];
    this.scene.background = new THREE.Color(t.background);
    this.floorMat.color.setHex(t.floor);
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private cast(e: PointerEvent): Pick | null {
    if (!this.view) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets: THREE.Object3D[] = [this.view.powerHit, ...[...this.view.ports.values()].map((p) => p.hit)];
    for (const h of this.raycaster.intersectObjects(targets, false)) {
      const pick = h.object.userData.pick as Pick | undefined;
      if (pick) return pick;
    }
    return null;
  }

  private describe(pick: Pick | null): string {
    const topo = this.sim.topo;
    if (!pick || !topo.has(this.deviceId)) return '';
    if (pick.type === 'power') {
      const d = topo.device(this.deviceId);
      return `Tombol power: ${d.powered ? 'menyala, klik untuk mematikan' : 'mati, klik untuk menyalakan'}.`;
    }
