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
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly devices = new Map<string, DeviceView>();
  private cables = new Map<string, CableView>();
  private packets = new Map<number, PacketView>();
  private zones: ZoneView[] = [];
  private zoneLabels: { ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; w: number; h: number; role: Role }[] = [];
  private arrows: { ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture }[] = [];
  private tags = new Map<string, HTMLElement>();
  private floorMat: THREE.MeshStandardMaterial;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private topoRev = -1;
  private layoutKey = '';
  private theme: SceneTheme = SCENE_THEMES.light;
  private themeName: ThemeName = 'light';
  private down?: { x: number; y: number; pick: Pick | null; floor?: THREE.Vector3 };
  private drag?: { id: string; offset: THREE.Vector3; from: THREE.Vector3 };
  private dangling?: THREE.Mesh;
  private danglingMat = new THREE.MeshStandardMaterial({ color: MATERIAL.accent, roughness: 0.5, transparent: true, opacity: 0.75 });
  private ghost?: { kind: DeviceKind; group: THREE.Group };
  private marker?: THREE.Mesh;
  private markerMat = new THREE.MeshBasicMaterial({ color: MATERIAL.accent });
  private markerKey = '';
  private tween?: { t: number; dur: number; fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3 };
  private observer: ResizeObserver;

  hovered: Pick | null = null;
  pendingPort: string | null = null;
  selected: { deviceId?: string; linkId?: string; packetId?: number } = {};
  follow = false;
  activeRole: Role | undefined;
  leadPacket: Packet | undefined;

  constructor(private container: HTMLElement, private sim: Simulator, private events: StageEvents) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    const canvas = this.renderer.domElement;
    canvas.className = 'stage-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Meja lab 3D berisi perangkat jaringan yang terhubung kabel. Panah kiri dan kanan memutar, panah atas dan bawah memiringkan, plus dan minus mendekatkan.');
    container.appendChild(canvas);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'stage-labels';
    container.appendChild(this.labels.domElement);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 300);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 60;
    this.controls.maxPolarAngle = 1.42;
    this.controls.screenSpacePanning = true;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc4c9d0, 1.45));
    const sun = new THREE.DirectionalLight(0xffffff, 1.45);
    sun.position.set(6, 18, 11);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -22;
    sc.right = 22;
    sc.top = 16;
    sc.bottom = -16;
    sc.near = 1;
    sc.far = 50;
    sun.shadow.bias = -0.0004;
    sun.shadow.radius = 6;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.55);
    fill.position.set(-10, 7, 14);
    this.scene.add(fill);

    this.floorMat = new THREE.MeshStandardMaterial({ color: this.theme.floor, roughness: 0.95 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.setTheme('light');
    this.syncTopology();

    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointerleave', () => this.setHover(null, 0, 0));
    canvas.addEventListener('keydown', (e) => this.onKey(e));
    // Size first, then frame the bench: the fit depends on the canvas shape.
    this.resize();
    this.fitView(false);
    let framedAspect = this.container.clientWidth > 0 ? this.camera.aspect : 0;
    this.observer = new ResizeObserver(() => {
      this.resize();
      // Reframe on first layout and when the shape changes a lot (a phone turned sideways).
      const a = this.camera.aspect;
      if (this.container.clientWidth > 0 && (!framedAspect || Math.abs(a - framedAspect) / framedAspect > 0.25)) {
        framedAspect = a;
        this.fitView(false);
      }
    });
    this.observer.observe(container);
  }

  // ------------------------------------------------------------------ theme and size

  setTheme(name: ThemeName): void {
    this.themeName = name;
    this.theme = SCENE_THEMES[name];
    this.scene.background = new THREE.Color(this.theme.background);
    this.floorMat.color.setHex(this.theme.floor);
    this.markerMat.color.setHex(this.theme.zoneActive);
    this.danglingMat.color.setHex(this.theme.zoneActive);
    this.layoutKey = '';
    this.activeRole = undefined;
  }

  refreshText(): void {
    this.layoutKey = '';
    for (const v of this.devices.values()) if (v.screen) v.screen.key = '';
    for (const v of [...this.devices.values()]) this.rebuildDevice(v.device.id);
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.9 ? 54 : w / h < 1.4 ? 44 : 38;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ devices and cables

  private addTag(view: DeviceView): void {
    const el = document.createElement('div');
    el.className = 'tag';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<span class="tag-role"></span><span class="tag-name"></span><span class="tag-ip"></span><span class="tag-off">Mati</span>';
    view.tagAnchor.add(new CSS2DObject(el));
    this.tags.set(view.device.id, el);
  }

  private updateTag(view: DeviceView): void {
    const el = this.tags.get(view.device.id);
    if (!el) return;
    const d = view.device;
    const role = roleOf(d);
    const ip = d.kind === 'switch' ? '' : d.kind === 'router' ? '' : d.ports[0].ip ?? 'tanpa IP';
    const set = (sel: string, text: string) => {
      const n = el.querySelector(sel)!;
      if (n.textContent !== text) n.textContent = text;
    };
    set('.tag-role', role === 'input' ? 'Input' : role === 'output' ? 'Output' : 'Proses');
    set('.tag-name', d.name);
    set('.tag-ip', ip);
    el.dataset.role = role;
    el.classList.toggle('is-off', !d.powered);
    el.classList.toggle('is-selected', this.selected.deviceId === d.id);
  }

  private removeDeviceView(id: string): void {
    const v = this.devices.get(id);
    if (!v) return;
    v.group.traverse((o) => {
      if (o instanceof CSS2DObject) o.element.remove();
    });
    this.scene.remove(v.group);
    disposeTree(v.group);
    this.devices.delete(id);
    this.tags.delete(id);
  }

  private rebuildDevice(id: string): void {
    const dev = this.sim.topo.devices.get(id);
    this.removeDeviceView(id);
    if (!dev) return;
    const view = buildDevice(dev);
    this.devices.set(id, view);
    this.scene.add(view.group);
    this.addTag(view);
  }

  syncTopology(force = false): void {
    if (!force && this.topoRev === this.sim.topo.rev) return;
    this.topoRev = this.sim.topo.rev;
    const topo = this.sim.topo;
    for (const id of [...this.devices.keys()]) if (!topo.devices.has(id)) this.removeDeviceView(id);
    for (const dev of topo.devices.values()) {
      const v = this.devices.get(dev.id);
      if (!v || v.signature !== signatureOf(dev)) this.rebuildDevice(dev.id);
      else if (this.drag?.id !== dev.id) v.group.position.set(dev.x, 0, dev.z);
    }
    for (const v of this.devices.values()) v.group.updateMatrixWorld(true);
    this.rebuildCables();
  }

  private footprints(): Box2[] {
    return [...this.devices.values()].map((v) => {
      const { x, z } = v.group.position;
      return { x0: x - v.half.x, x1: x + v.half.x, z0: z + v.half.z0, z1: z + v.half.z1 };
    });
  }

  private rebuildCables(only?: string): void {
    const topo = this.sim.topo;
    for (const c of [...this.cables.values()]) {
      if (only && !c.a.startsWith(`${only}.`) && !c.b.startsWith(`${only}.`)) continue;
      this.scene.remove(c.group);
      disposeTree(c.group);
      this.cables.delete(c.linkId);
    }
    const boxes = this.footprints();
    let lane = 0;
    for (const link of topo.links.values()) {
      lane++;
      if (this.cables.has(link.id)) continue;
      const pa = this.portView(link.a);
      const pb = this.portView(link.b);
      if (!pa || !pb) continue;
      const curve = cableCurve(pa, pb, boxes, lane % 3);
      const mat = cableMaterial();
      const tubeMesh = new THREE.Mesh(tube(curve), mat);
      tubeMesh.castShadow = true;
      tubeMesh.receiveShadow = true;
      const pick: Pick = { type: 'cable', linkId: link.id };
      const group = new THREE.Group();
      group.add(tubeMesh);
      for (const p of [pa, pb]) group.add(buildPlug(p, mat));
      group.traverse((o) => {
        o.userData.pick = pick;
      });
      this.scene.add(group);
      this.cables.set(link.id, { linkId: link.id, a: link.a, b: link.b, group, mesh: tubeMesh, mat, curve });
    }
  }

  portView(portId: string): PortView | undefined {
    const deviceId = portId.slice(0, portId.lastIndexOf('.'));
    return this.devices.get(deviceId)?.ports.get(portId);
  }

  // ------------------------------------------------------------------ zones

  private rebuildZones(): void {
    for (const z of this.zones) {
      this.scene.remove(z.group);
      disposeTree(z.group);
    }
    this.zones = [];
    this.zoneLabels = [];
    this.arrows = [];
    const rects = new Map<Role, Box2>();
    for (const v of this.devices.values()) {
      const f = footprintOf(v);
      const r = roleOf(v.device);
      const cur = rects.get(r);
      rects.set(r, cur ? { x0: Math.min(cur.x0, f.x0), x1: Math.max(cur.x1, f.x1), z0: Math.min(cur.z0, f.z0), z1: Math.max(cur.z1, f.z1) } : { ...f });
    }
    if (!rects.size) return;
    const allZ1 = Math.max(...[...rects.values()].map((r) => r.z1));
    const allZ0 = Math.min(...[...rects.values()].map((r) => r.z0));
    const order: Role[] = ['input', 'process', 'output'];
    for (const role of order) {
      const r = rects.get(role);
      if (!r) continue;
      const x0 = r.x0 - 0.75;
      const x1 = r.x1 + 0.75;
      const z0 = allZ0 - 0.8;
      const z1 = allZ1 + 1.4;
      const group = new THREE.Group();
      const fillGeo = new THREE.ShapeGeometry(roundedRectShape(x0, z0, x1, z1, 0.4), 8);
      fillGeo.rotateX(-Math.PI / 2);
      const fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: this.theme.zone, transparent: true, opacity: 0.85, depthWrite: false }));
      fill.position.y = 0.002;
      group.add(fill);
      const edge = new THREE.MeshBasicMaterial({ color: this.theme.zoneEdge });
      const edgeMesh = new THREE.Mesh(outlineGeometry(x0, z0, x1, z1, 0.4, 0.045), edge);
      edgeMesh.position.y = 0.004;
      group.add(edgeMesh);
      const lw = Math.min(x1 - x0 - 0.3, 4.2);
      const lh = lw * 0.3;
      const [c, ctx] = makeCanvas(900, 270);
      const tex = canvasTexture(c);
      drawZoneLabel(ctx, c.width, c.height, ZONE_TEXT[role][0], ZONE_TEXT[role][1], this.theme.label, this.theme.labelMuted);
      tex.needsUpdate = true;
      const label = new THREE.Mesh(new THREE.PlaneGeometry(lw, lh), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      label.rotation.x = -Math.PI / 2;
      label.position.set((x0 + x1) / 2, 0.006, z1 + lh / 2 + 0.15);
      group.add(label);
      this.zoneLabels.push({ ctx, tex, w: c.width, h: c.height, role });
      this.scene.add(group);
      this.zones.push({ role, group, edge });
    }
    // Arrows between the zones, only when they read left to right.
    const present = order.filter((r) => rects.has(r));
    for (let i = 0; i + 1 < present.length; i++) {
      const a = rects.get(present[i])!;
      const b = rects.get(present[i + 1])!;
      if (a.x1 + 0.75 >= b.x0 - 0.75) continue;
      const [c, ctx] = makeCanvas(256, 128);
      const tex = canvasTexture(c);
      drawArrow(ctx, 256, 128, this.theme.arrow);
      tex.needsUpdate = true;
      const arrow = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      arrow.rotation.x = -Math.PI / 2;
      arrow.position.set((a.x1 + b.x0) / 2, 0.006, allZ1 + 1.4 + 0.6);
      this.zones[0].group.add(arrow);
      this.arrows.push({ ctx, tex });
    }
  }

  // ------------------------------------------------------------------ input

  private pickables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const v of this.devices.values()) {
      out.push(v.powerHit, ...v.hits);
      for (const p of v.ports.values()) out.push(p.hit);
    }
    for (const c of this.cables.values()) out.push(c.group);
    for (const p of this.packets.values()) out.push(p.mesh);
    return out;
  }

  private setPointer(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private cast(e: PointerEvent): Pick | null {
    this.setPointer(e);
    for (const h of this.raycaster.intersectObjects(this.pickables(), true)) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.pick) o = o.parent;
      if (o) return o.userData.pick as Pick;
    }
    return null;
  }

  private floorPoint(e: PointerEvent): THREE.Vector3 | undefined {
    this.setPointer(e);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.floorPlane, p) ? p : undefined;
  }

  private onDown(e: PointerEvent): void {
    const pick = this.cast(e);
    this.down = { x: e.clientX, y: e.clientY, pick, floor: this.floorPoint(e) };
  }

  private onMove(e: PointerEvent): void {
    if (this.ghost) {
      const p = this.floorPoint(e);
      if (p) this.ghost.group.position.set(Math.round(p.x * 5) / 5, 0, Math.round(p.z * 5) / 5);
      this.renderer.domElement.style.cursor = 'copy';
      return;
    }
    if (this.down && !this.drag && this.down.pick?.type === 'device' && e.buttons === 1) {
      const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
      const v = this.devices.get(this.down.pick.deviceId);
      if (moved > 6 && v && this.down.floor) {
        this.drag = { id: v.device.id, offset: v.group.position.clone().sub(this.down.floor), from: v.group.position.clone() };
        this.controls.enabled = false;
        this.renderer.domElement.style.cursor = 'grabbing';
      }
    }
    if (this.drag) {
      const p = this.floorPoint(e);
      const v = this.devices.get(this.drag.id);
      if (p && v) {
        v.group.position.set(p.x + this.drag.offset.x, 0, p.z + this.drag.offset.z);
        v.group.updateMatrixWorld(true);
        this.rebuildCables(this.drag.id);
        this.layoutKey = '';
      }
      return;
    }
    const pick = this.cast(e);
    this.setHover(pick, e.clientX, e.clientY);
    if (this.pendingPort) {
      const point = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.floorPlane, point)) this.drawDangling(point);
    }
  }

  private setHover(pick: Pick | null, x: number, y: number): void {
    const same = JSON.stringify(pick) === JSON.stringify(this.hovered);
    this.hovered = pick;
    this.renderer.domElement.style.cursor = pick ? (pick.type === 'device' ? 'grab' : 'pointer') : '';
    if (!same || pick) this.events.hover(pick, x, y);
  }

  private onUp(e: PointerEvent): void {
    const down = this.down;
    this.down = undefined;
    if (this.drag) {
      const d = this.drag;
      this.drag = undefined;
      this.controls.enabled = true;
      const v = this.devices.get(d.id);
      if (v && !this.events.move(d.id, v.group.position.x, v.group.position.z)) {
        v.group.position.copy(d.from);
        v.group.updateMatrixWorld(true);
        this.rebuildCables(d.id);
      }
      this.layoutKey = '';
      return;
    }
    if (!down || e.button !== 0) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    if (this.ghost) {
      const p = this.ghost.group.position;
      this.events.place(this.ghost.kind, p.x, p.z);
      return;
    }
    this.events.pick(this.cast(e));
  }

  private onKey(e: KeyboardEvent): void {
    const k = e.key;
    if (k === 'ArrowLeft') this.rotate(-0.22);
    else if (k === 'ArrowRight') this.rotate(0.22);
    else if (k === 'ArrowUp') this.tilt(-0.12);
    else if (k === 'ArrowDown') this.tilt(0.12);
    else if (k === '+' || k === '=') this.zoom(0.8);
    else if (k === '-' || k === '_') this.zoom(1.25);
    else return;
    e.preventDefault();
  }

  private drawDangling(point: THREE.Vector3): void {
    const port = this.pendingPort ? this.portView(this.pendingPort) : undefined;
    if (!port) return;
    const geo = tube(danglingCurve(port, point), 0.034);
    if (!this.dangling) {
      this.dangling = new THREE.Mesh(geo, this.danglingMat);
      this.scene.add(this.dangling);
    } else {
      this.dangling.geometry.dispose();
      this.dangling.geometry = geo;
    }
  }

  setPending(portId: string | null): void {
    this.pendingPort = portId;
    if (!portId && this.dangling) {
      this.scene.remove(this.dangling);
      this.dangling.geometry.dispose();
      this.dangling = undefined;
    }
  }

  /** Start or stop placing a new device; the ghost follows the pointer until a click. */
  setPlacing(kind: DeviceKind | null): void {
    if (this.ghost) {
      this.scene.remove(this.ghost.group);
      disposeTree(this.ghost.group);
      this.ghost = undefined;
    }
    if (kind) {
      const group = buildGhost(kind);
      group.position.copy(this.controls.target).setY(0);
      this.scene.add(group);
      this.ghost = { kind, group };
    }
    this.renderer.domElement.style.cursor = kind ? 'copy' : '';
  }

  /** Where a new device would land if placed from the keyboard: the middle of the view. */
  centrePoint(): { x: number; z: number } {
    return { x: this.controls.target.x, z: this.controls.target.z };
  }

  // ------------------------------------------------------------------ camera

  private animateTo(target: THREE.Vector3, position: THREE.Vector3, dur = 0.75): void {
    this.tween = { t: 0, dur, fromPos: this.camera.position.clone(), toPos: position, fromTarget: this.controls.target.clone(), toTarget: target };
  }

  /** Frames every device on the bench. */
  fitView(animate = true): void {
    this.follow = false;
    const boxes = this.footprints();
    if (!boxes.length) boxes.push({ x0: -4, x1: 4, z0: -3, z1: 3 });
    // The zones reach 0.75 past the devices and their labels sit in front; tags float above.
    const x0 = Math.min(...boxes.map((b) => b.x0)) - 0.9;
    const x1 = Math.max(...boxes.map((b) => b.x1)) + 0.9;
    const z0 = Math.min(...boxes.map((b) => b.z0)) - 0.9;
    const z1 = Math.max(...boxes.map((b) => b.z1)) + 2.6;
    const corners = [x0, x1].flatMap((x) => [z0, z1].flatMap((z) => [0, 2.3].map((y) => new THREE.Vector3(x, y, z))));
    // The free part of the view, in normalised screen units: the palette covers the left edge,
    // the camera tools the top, the flow bar the bottom.
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const narrow = w <= 640;
    // Device name tags are fixed-size HTML, so leave room for half a tag on each side.
    const free = {
      left: -1 + (2 * (narrow ? 52 : 150)) / w,
      right: 1 - (2 * (narrow ? 52 : 70)) / w,
