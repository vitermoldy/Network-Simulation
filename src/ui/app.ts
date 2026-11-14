// The page around the 3D bench: the request form, the device palette, the run controls, and the
// four panels (Alur, Paket, Perangkat, Riwayat). The simulator is the single source of truth; the
// panels redraw when its version number moves.

import * as api from '../data/api';
import { layersOf, readsUpTo, type Packet } from '../engine/packet';
import { type LogEntry, type PhaseStatus, type Scenario, Simulator } from '../engine/sim';
import { isClient, KIND_LABEL, roleOf, type DeviceKind, type Role } from '../engine/topology';
import type { Pick } from '../scene/devices';
import type { Stage, StageEvents } from '../scene/stage';
import type { DeviceViewer } from '../scene/viewer';
import { drawBrowser, makeCanvas, SCREEN_H, SCREEN_W } from '../scene/textures';
import { IosShell, prefixToMask, PromptShell, type Shell } from './terminal';
import type { ThemeName } from '../scene/theme';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const num = (n: number, d = 1) => n.toFixed(d).replace('.', ',');

const ROLE_TEXT: Record<Role, string> = {
  input: 'Input: tempat alamat diketik dan halaman ditampilkan.',
  process: 'Proses: meneruskan atau membantu paket di jalan.',
  output: 'Output: menyiapkan jawaban untuk pengirim.',
};

const KIND_TEXT: Record<DeviceKind, string> = {
  pc: 'Klien. Browser di sini membuat permintaan, lalu menampilkan halaman yang datang.',
  laptop: 'Klien. Browser di sini membuat permintaan, lalu menampilkan halaman yang datang.',
  switch: 'Bekerja di lapisan 2. Switch hanya membaca alamat MAC, lalu meneruskan frame ke port yang tepat. Tabel MAC-nya terisi sendiri dari frame yang lewat. Port-nya tidak diberi IP.',
  router: 'Bekerja di lapisan 3. Router membaca IP tujuan, mencocokkannya dengan tabel routing, lalu meneruskan paket ke router berikutnya dengan header Ethernet baru. Tiap port harus di jaringan yang berbeda.',
  server: 'Menjalankan layanan untuk perangkat lain. DNS menerjemahkan nama menjadi IP; HTTP mengirim halaman web lewat TCP port 80.',
};

const STATUS_WORD: Record<PhaseStatus, string> = { waiting: 'menunggu', active: 'berjalan', done: 'selesai', failed: 'gagal', skipped: 'dilewati' };

const KIND_CHIP: Partial<Record<LogEntry['kind'], string>> = { loss: 'Hilang', retry: 'Ulang', route: 'Rute', ok: 'Beres', error: 'Gagal', change: 'Diubah' };

const SCENARIO_TEXT: Record<Scenario, string> = {
  normal: 'Skenario normal: semua kabel dan perangkat bekerja.',
  loss: 'Skenario paket hilang: segmen kedua dari server rusak di kabel kedua yang dilewatinya, lalu dikirim ulang.',
  'router-down': 'Skenario router mati: saat server mengirim halaman, router di tengah jalur padam dan router lain mencari jalan memutar.',
  'bad-domain': 'Skenario nama domain tidak ada: server DNS tidak mengenal nama yang diketik.',
};

const SCENARIO_SHORT: Record<string, string> = { normal: 'Normal', loss: 'Paket hilang', 'router-down': 'Router mati', 'bad-domain': 'Domain salah', ping: 'ping', lookup: 'nslookup' };

const ICON = {
  done: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5"/><path d="m6.2 10.2 2.6 2.6 5-5.4"/></svg>',
  active: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5"/><circle cx="10" cy="10" r="3.6" class="fill"/></svg>',
  waiting: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" stroke-dasharray="3 3"/></svg>',
  failed: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5"/><path d="m7 7 6 6M13 7l-6 6"/></svg>',
  skipped: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5"/><path d="M6 10h8"/></svg>',
  power: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.2 5.6a6 6 0 1 0 7.6 0M10 3v6.5"/></svg>',
};

type Tab = 'alur' | 'paket' | 'perangkat' | 'riwayat';
const TABS: Tab[] = ['alur', 'paket', 'perangkat', 'riwayat'];
type DwTab = 'fisik' | 'config' | 'desktop' | 'cli';
const DW_TABS: DwTab[] = ['fisik', 'config', 'desktop', 'cli'];

interface TermState {
  shell: Shell;
  lines: string[];
  history: string[];
  index: number;
}

const APP_ICONS = {
  ip: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="10" width="36" height="24" rx="3"/><path d="M14 18h6M14 24h10M28 18h6M28 24h6M18 40h12M24 34v6"/></svg>',
  prompt: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="9" width="36" height="30" rx="3"/><path d="m13 19 6 5-6 5M23 30h11"/></svg>',
  browser: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="16"/><path d="M8 24h32M24 8c5 4.5 7 10 7 16s-2 11.5-7 16c-5-4.5-7-10-7-16s2-11.5 7-16Z"/></svg>',
};

export class App {
  private stage: Stage | null = null;
  private playing = false;
  private stepOnce = false;
  private speed = 1;
  private tab: Tab = 'alur';
  private renderedVersion = -1;
  private renderedLog = 0;
  private openEntry: number | null = null;
  private followLatest = true;
  private selectedPacket: number | null = null;
  private selectedDevice = 'r1';
  private selectedLink: string | null = null;
  private pendingPort: string | null = null;
  private placing: DeviceKind | null = null;
  private popoverAction: (() => void) | null = null;
  private deviceKey = '';
  private deviceDirty = false;
  private packetKey = '';
  private sourceKey = '';
  private toastTimer = 0;
  // Device window.
  private dwTab: DwTab = 'fisik';
  private viewer: DeviceViewer | null = null;
  private viewerLoading = false;
  private desktopApp: 'home' | 'ip' | 'prompt' | 'browser' = 'home';
  private terms = new Map<string, TermState>();
  private stream = { deviceId: '', printed: 0 };
  private portsKey = '';
  private desktopKey = '';
  private browserCanvas?: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; key: string };
  private last = performance.now();
  private timerTick = 0;
  private lastStatus: Simulator['status'] = 'idle';
  private runScenario: Scenario = 'normal';

  constructor(private sim: Simulator) {}

  async init(createStage: () => Promise<Stage>): Promise<void> {
    this.bindControls();
    this.renderAll();
    void this.refreshDb();
    try {
      this.stage = await createStage();
      $('stage-state').hidden = true;
      this.stage.setTheme(this.theme());
      document.fonts?.ready.then(() => this.stage?.refreshText());
      try {
        if (!localStorage.getItem('netsim-hint-seen')) $('hint').hidden = false;
      } catch {
        $('hint').hidden = false;
      }
    } catch (err) {
      console.error(err);
      const s = $('stage-state');
      s.classList.add('is-error');
      s.textContent = 'Browser ini tidak bisa menampilkan 3D (WebGL mati atau tidak tersedia). Simulasinya tetap berjalan: ikuti langkahnya di panel Alur, dan atur perangkat di panel Perangkat.';
      document.querySelectorAll<HTMLButtonElement>('.palette button, .stage-tools button').forEach((b) => {
        b.disabled = true;
      });
    }
    requestAnimationFrame((t) => this.tick(t));
  }

  stageEvents(): StageEvents {
    return {
      pick: (p) => this.onPick(p),
      hover: (p, x, y) => this.onHover(p, x, y),
      place: (kind, x, z) => this.place(kind, x, z),
      move: (id, x, z) => this.move(id, x, z),
    };
  }

  // ------------------------------------------------------------------ loop

  private tick(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const sim = this.sim;
    const moving = sim.status === 'running' || !sim.quiet || sim.lost.length > 0;
    if (this.playing && moving) {
      sim.stepMode = $<HTMLInputElement>('stepmode').checked || this.stepOnce;
      const fast = sim.status === 'running' && sim.quiet && sim.lost.length === 0;
      const r = sim.advance(dt * this.speed * (fast ? 6 : 1));
      if (r === 'step') {
        this.playing = false;
        this.stepOnce = false;
      }
      $('clock').classList.toggle('is-fast', fast);
    } else if (this.playing && sim.status !== 'running') {
      this.playing = false;
    }
    if (this.lastStatus === 'running' && (sim.status === 'done' || sim.status === 'failed')) void this.recordRun();
    this.lastStatus = sim.status;
    if (this.stage) {
      this.stage.selected = { deviceId: this.selectedDevice, linkId: this.selectedLink ?? undefined, packetId: this.selectedPacket ?? undefined };
      this.stage.frame(dt);
    }
    this.viewer?.frame();
    this.streamOutput();
    if (this.dwOpen() && this.dwTab === 'desktop' && this.desktopApp === 'browser') this.paintBrowser();
    if (sim.version !== this.renderedVersion) this.renderAll();
    if (++this.timerTick % 6 === 0) this.renderTimers();
    this.renderFlow();
    this.renderPlaybar();
    requestAnimationFrame((t) => this.tick(t));
  }

  // ------------------------------------------------------------------ controls

  private theme(): ThemeName {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  private bindControls(): void {
    $('request').addEventListener('submit', (e) => {
      e.preventDefault();
      this.send();
    });
    $('url').addEventListener('input', () => this.clearUrlError());
    $('source').addEventListener('change', () => this.clearUrlError());
    $<HTMLSelectElement>('scenario').addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value as Scenario;
      const url = $<HTMLInputElement>('url');
      if (v === 'bad-domain') url.value = 'www.tidakada.test';
      else if (url.value === 'www.tidakada.test') url.value = 'www.jaringan.test';
      if (this.sim.status === 'idle') this.renderStatus();
      this.toast(this.sim.status === 'running' ? 'Skenario baru berlaku saat permintaan berikutnya dikirim.' : SCENARIO_TEXT[v]);
    });
    $('theme').addEventListener('click', () => {
      const next: ThemeName = this.theme() === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem('netsim-theme', next);
      } catch {
        /* the theme still applies for this visit */
      }
      this.stage?.setTheme(next);
      this.viewer?.setTheme(next);
      this.syncThemeButton();
    });
    this.syncThemeButton();

    $('play').addEventListener('click', () => {
      if (this.sim.status === 'idle' || ((this.sim.status === 'done' || this.sim.status === 'failed') && this.sim.quiet)) {
        this.send();
        return;
      }
      this.playing = !this.playing;
      this.stepOnce = false;
    });
    $('step').addEventListener('click', () => {
      if (this.sim.status === 'idle') {
        this.send(true);
        return;
      }
      this.playing = true;
      this.stepOnce = true;
    });
    $('reset').addEventListener('click', () => {
      this.sim.stop();
      this.playing = false;
      this.selectedPacket = null;
      this.followLatest = true;
      this.renderedLog = 0;
      $('log').innerHTML = '';
      this.renderAll();
    });
    document.querySelectorAll<HTMLInputElement>('input[name="speed"]').forEach((r) =>
      r.addEventListener('change', () => {
        this.speed = Number(r.value);
      }),
    );
    $<HTMLSelectElement>('loss').addEventListener('change', (e) => {
      this.sim.lossRate = Number((e.target as HTMLSelectElement).value);
    });

    document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) =>
      b.addEventListener('click', () => {
        const s = this.stage;
        if (!s) return;
        const k = b.dataset.cam;
        if (k === 'left') s.rotate(-0.3);
        else if (k === 'right') s.rotate(0.3);
        else if (k === 'in') s.zoom(0.78);
        else if (k === 'out') s.zoom(1.28);
        else if (k === 'reset') {
          s.resetView();
          $('follow').setAttribute('aria-pressed', 'false');
        }
      }),
    );
    $('follow').addEventListener('click', () => {
      if (!this.stage) return;
      this.stage.follow = !this.stage.follow;
      $('follow').setAttribute('aria-pressed', String(this.stage.follow));
    });
    $('help-open').addEventListener('click', () => {
      $('hint').hidden = false;
      $('hint-close').focus();
    });
    $('hint-close').addEventListener('click', () => {
      $('hint').hidden = true;
      try {
        localStorage.setItem('netsim-hint-seen', '1');
      } catch {
        /* shown again next visit */
      }
    });
    document.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((b) =>
      b.addEventListener('click', () => this.startPlacing(b.dataset.add as DeviceKind)),
    );
    $('popover-action').addEventListener('click', () => {
      const act = this.popoverAction;
      this.closePopover();
      act?.();
    });
    $('popover-close').addEventListener('click', () => this.closePopover());
    $('recable').addEventListener('click', () => {
      this.confirm('Kembalikan jaringan ke delapan perangkat awal? Perangkat yang kamu tambah dan semua pengaturan akan hilang, kecuali yang sudah disimpan sebagai rancangan.', 'Kembalikan', () => {
        this.sim.resetTopology();
        this.afterTopologySwap('Jaringan kembali ke susunan awal.');
      });
    });

    TABS.forEach((t, i) => {
      const b = $(`tab-${t}`);
      b.addEventListener('click', () => this.showTab(t));
      b.addEventListener('keydown', (e) => {
        const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        const next = TABS[(i + dir + TABS.length) % TABS.length];
        this.showTab(next);
        $(`tab-${next}`).focus();
      });
    });

    $('log').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button.entry');
      if (!btn) return;
      const entry = this.sim.log.find((l) => l.id === Number(btn.dataset.id));
      if (!entry) return;
      this.openEntry = this.openEntry === entry.id ? null : entry.id;
      $('log').querySelectorAll('.entry').forEach((el) => el.classList.toggle('is-open', Number((el as HTMLElement).dataset.id) === this.openEntry));
      if (entry.packetId) {
        this.selectedPacket = entry.packetId;
        this.followLatest = false;
      }
      if (entry.deviceId && this.sim.topo.has(entry.deviceId)) this.selectedDevice = entry.deviceId;
    });

    $('packet').addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('#follow-latest')) {
        this.followLatest = true;
        this.selectedPacket = null;
        this.packetKey = '';
        this.renderPacket();
      }
    });

    $('devices').addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const power = t.closest<HTMLButtonElement>('button[data-power]');
      if (power) {
        this.togglePower(power.dataset.power!);
        return;
      }
      const pick = t.closest<HTMLButtonElement>('button[data-pick]');
      if (pick) this.openDevice(pick.dataset.pick!);
    });
    this.bindDevicePanel();
    this.bindDeviceWindow();
    this.bindHistoryPanel();

    document.addEventListener('keydown', (e) => {
      const typing = (e.target as HTMLElement).closest('input, select, textarea');
      if (e.key === 'Escape') {
        if (!$('popover').hidden) this.closePopover();
        else if (this.placing) this.stopPlacing('Batal menaruh perangkat.');
        else if (this.pendingPort) {
          this.setPending(null);
          this.toast('Pemasangan kabel dibatalkan.');
        } else if (!$('hint').hidden) $('hint-close').click();
        else if (this.dwOpen()) this.closeDevice();
        return;
      }
      if (typing) return;
      if (e.key === 'Enter' && this.placing && this.stage && !(e.target as HTMLElement).closest('button')) {
        e.preventDefault();
        const c = this.stage.centrePoint();
        const spot = this.freeSpot(this.placing, c.x, c.z);
        this.place(this.placing, spot.x, spot.z);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && $('popover').hidden) {
        if (this.selectedLink) this.askUnplug(this.selectedLink);
        else if (this.selectedDevice && this.sim.topo.has(this.selectedDevice) && (e.target as HTMLElement).closest('.stage-wrap')) this.askRemove(this.selectedDevice);
      }
    });
  }

  private clearUrlError(): void {
    $('url-error').hidden = true;
    $('url').removeAttribute('aria-invalid');
  }

  private syncThemeButton(): void {
    $('theme').setAttribute('aria-label', this.theme() === 'dark' ? 'Pakai tema terang' : 'Pakai tema gelap');
    $('theme').title = this.theme() === 'dark' ? 'Tema terang' : 'Tema gelap';
  }

  private send(step = false): void {
    const input = $<HTMLInputElement>('url');
    const host = input.value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
    const err = $('url-error');
    const source = $<HTMLSelectElement>('source').value;
    if (!source) {
      err.textContent = 'Belum ada PC atau laptop di meja. Tambahkan satu dari palet, sambungkan kabelnya, lalu kirim lagi.';
      err.hidden = false;
      return;
    }
    if (!host || !/^[a-z0-9.-]+$/.test(host) || host.startsWith('.') || host.endsWith('.')) {
      err.textContent = host ? 'Alamat hanya boleh berisi huruf, angka, titik, dan tanda minus, misalnya www.jaringan.test.' : 'Ketik alamat web dulu, misalnya www.jaringan.test.';
      err.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    const scenario = $<HTMLSelectElement>('scenario').value as Scenario;
    this.runScenario = scenario;
    this.sim.scenario = scenario === 'bad-domain' ? 'normal' : scenario;
    this.sim.start(host, (Math.random() * 1e9) | 0, source);
    this.beginRun(step);
  }

  /** Common bookkeeping once any run (web, ping, nslookup) has started. */
  private beginRun(step = false): void {
    this.lastStatus = 'running';
    this.playing = true;
    this.stepOnce = step;
    this.selectedPacket = null;
    this.followLatest = true;
    this.openEntry = null;
    this.renderedLog = 0;
    this.stream = { deviceId: this.sim.outputDevice, printed: 0 };
    $('log').innerHTML = '';
    this.closePopover();
    this.setPending(null);
    this.stopPlacing();
    this.showTab('alur');
    this.renderAll();
  }

  /** ping or nslookup typed into a Command Prompt or CLI. */
  private shellRun(kind: 'ping' | 'lookup', deviceId: string, target: string): string | undefined {
    if (this.sim.status === 'running') return 'Masih ada simulasi yang berjalan. Tunggu sampai selesai, atau tekan Atur ulang di bawah meja.';
    this.runScenario = kind === 'ping' ? 'normal' : 'normal';
    this.sim.scenario = 'normal';
    if (kind === 'ping') this.sim.startPing(deviceId, target, (Math.random() * 1e9) | 0);
    else this.sim.startLookup(deviceId, target, (Math.random() * 1e9) | 0);
    this.beginRun();
    return undefined;
  }

  /** The Web Browser app on a PC's Desktop: same run as the header form, from that PC. */
  private browse(deviceId: string, rawUrl: string): void {
    $<HTMLSelectElement>('source').value = deviceId;
    $<HTMLInputElement>('url').value = rawUrl.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    this.send();
  }

  // ------------------------------------------------------------------ devices on the bench

  private startPlacing(kind: DeviceKind): void {
    if (!this.stage) return;
    this.setPending(null);
    this.closePopover();
    this.placing = kind;
    this.stage.setPlacing(kind);
    document.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.add === kind)));
    this.toast(`Klik tempat kosong di meja untuk menaruh ${KIND_LABEL[kind]}. Enter menaruhnya di tengah tampilan, Esc untuk batal.`);
  }

  private stopPlacing(message?: string): void {
    if (!this.placing) return;
    this.placing = null;
    this.stage?.setPlacing(null);
    document.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    if (message) this.toast(message);
  }

  /** Nearest spot to (x, z) where a device of `kind` does not sit on another one. */
  private freeSpot(kind: DeviceKind, x: number, z: number): { x: number; z: number } {
    const topo = this.sim.topo;
    if (!topo.overlaps(kind, x, z)) return { x, z };
    for (let r = 1; r < 30; r++) {
      for (let a = 0; a < 12; a++) {
        const px = x + Math.cos((a / 12) * Math.PI * 2) * r * 1.2;
        const pz = z + Math.sin((a / 12) * Math.PI * 2) * r * 1.2;
        if (!topo.overlaps(kind, px, pz)) return { x: px, z: pz };
      }
    }
    return { x, z: z + 8 };
  }

  private place(kind: DeviceKind, x: number, z: number): void {
    const hit = this.sim.topo.overlaps(kind, x, z);
    if (hit) {
      this.toast(`Tempat itu terlalu dekat dengan ${hit.name}. Pilih tempat yang lebih lega.`);
      return;
    }
    if (this.sim.topo.devices.size >= 60) {
      this.toast('Meja sudah penuh: paling banyak 60 perangkat.');
      return;
    }
    const d = this.sim.addDevice(kind, x, z);
    this.stopPlacing();
    this.openDevice(d.id, 'config');
    const next = kind === 'pc' || kind === 'laptop'
      ? 'Sambungkan kabelnya ke switch, lalu tekan IP otomatis.'
      : kind === 'router' ? 'Port router baru masih shutdown, seperti di Packet Tracer. Beri IP, centang Aktif (atau no shutdown di CLI), lalu sambungkan kabelnya.'
        : kind === 'server' ? 'Sambungkan kabelnya, beri IP, lalu pilih layanannya.'
          : 'Sambungkan kabel dari PC dan dari router ke port-nya.';
    this.toast(`${d.name} ditaruh di meja. ${next}`);
  }

  private move(id: string, x: number, z: number): boolean {
    const d = this.sim.topo.device(id);
    const hit = this.sim.topo.overlaps(d.kind, x, z, id);
    if (hit) {
      this.toast(`${d.name} tidak bisa ditaruh di atas ${hit.name}.`);
      return false;
    }
    this.sim.moveDevice(id, x, z);
    return true;
  }

  // ------------------------------------------------------------------ device window

  private dwOpen(): boolean {
    return $<HTMLDialogElement>('devwin').open;
  }

  /** Opens a device's own window, the way a click on a device does in Packet Tracer. */
  openDevice(id: string, tab: DwTab = 'fisik'): void {
    if (!this.sim.topo.has(id)) return;
    const d = this.sim.topo.device(id);
    const changed = this.selectedDevice !== id;
    this.selectedDevice = id;
    if (changed) this.desktopApp = 'home';
    const client = d.kind === 'pc' || d.kind === 'laptop';
    const cli = d.kind === 'router' || d.kind === 'switch';
    $('dwt-desktop').hidden = !client;
    $('dwt-cli').hidden = !cli;
    if ((tab === 'desktop' && !client) || (tab === 'cli' && !cli)) tab = 'fisik';
    const dialog = $<HTMLDialogElement>('devwin');
    if (!dialog.open) dialog.show();
    this.deviceKey = '';
    this.portsKey = '';
    this.desktopKey = '';
    this.showDwTab(tab);
    this.renderDeviceList();
    $(`dwt-${tab}`).focus();
  }

  private closeDevice(): void {
    const dialog = $<HTMLDialogElement>('devwin');
    if (!dialog.open) return;
    dialog.close();
    if (this.viewer) this.viewer.active = false;
    (document.querySelector('.stage-canvas') as HTMLElement | null)?.focus();
  }

  private showDwTab(tab: DwTab): void {
    this.dwTab = tab;
    for (const t of DW_TABS) {
      const b = $(`dwt-${t}`);
      b.setAttribute('aria-selected', String(t === tab));
      b.tabIndex = t === tab ? 0 : -1;
      $(`dw-${t}`).hidden = t !== tab;
    }
    if (this.viewer) this.viewer.active = tab === 'fisik';
    if (tab === 'fisik') void this.ensureViewer();
    this.deviceKey = '';
    this.portsKey = '';
    this.desktopKey = '';
    this.renderDeviceWindow();
    if (tab === 'cli') this.renderTerm($('cli-term'), this.selectedDevice);
  }

  private async ensureViewer(): Promise<void> {
    if (!this.stage) {
      $('viewer').querySelector('.viewer-hover')!.textContent = 'Tampilan 3D tidak tersedia di browser ini (WebGL mati). Pengaturan tetap bisa dipakai di tab Config.';
      return;
    }
    if (!this.viewer && !this.viewerLoading) {
      this.viewerLoading = true;
      const { DeviceViewer } = await import('../scene/viewer');
      this.viewer = new DeviceViewer($('viewer'), this.sim, {
        power: (id) => this.togglePower(id),
        hover: (text) => {
          const el = $('viewer-hover');
          if (el.textContent !== text) el.textContent = text;
        },
      });
      this.viewer.setTheme(this.theme());
      this.viewerLoading = false;
    }
    if (this.viewer) {
      if (this.viewer.deviceId !== this.selectedDevice) this.viewer.show(this.selectedDevice);
      this.viewer.active = this.dwOpen() && this.dwTab === 'fisik';
    }
  }

  private renderDeviceWindow(): void {
    if (!this.dwOpen()) return;
    const topo = this.sim.topo;
    if (!topo.has(this.selectedDevice)) {
      this.closeDevice();
      return;
    }
    const d = topo.device(this.selectedDevice);
    const title = $('devwin-title');
    if (title.textContent !== d.name) title.textContent = d.name;
    const used = d.ports.filter((p) => topo.linkOf(p.id)).length;
    const sub = `${KIND_LABEL[d.kind]}, ${roleOf(d) === 'input' ? 'input' : roleOf(d) === 'output' ? 'output' : 'proses'}. ${used} dari ${d.ports.length} port berkabel. ${d.powered ? 'Menyala' : 'Mati'}.`;
    if ($('devwin-sub').textContent !== sub) $('devwin-sub').textContent = sub;
    if (this.dwTab === 'fisik') {
      if (this.viewer && this.viewer.deviceId !== d.id) this.viewer.show(d.id);
      this.renderPorts();
    } else if (this.dwTab === 'config') this.renderDevice();
    else if (this.dwTab === 'desktop') this.renderDesktop();
  }

  private renderPorts(): void {
    const topo = this.sim.topo;
    const d = topo.device(this.selectedDevice);
    const key = JSON.stringify([d.id, topo.rev]);
    if (key === this.portsKey) return;
    this.portsKey = key;
    const rows = d.ports.map((p) => {
      const peer = topo.peer(p.id);
      const state = p.down ? 'shutdown' : !peer ? 'kosong' : topo.carrier(p.id) ? 'tersambung' : 'tanpa sinyal';
      return [p.name, p.ip ? `${p.ip}/${p.prefix}` : '-', state, peer ? topo.portLabel(peer) : '-'];
    });
    $('dw-ports').innerHTML = `<h3 class="sub">Port</h3>${this.table(['Port', 'IP', 'Status', 'Kabel ke'], rows, '')}`;
  }

  // Desktop (PC, laptop): IP Configuration, Command Prompt, Web Browser.

  private renderDesktop(): void {
    const box = $('desktop');
    const d = this.sim.topo.device(this.selectedDevice);
    const key = JSON.stringify([d.id, this.desktopApp, this.desktopApp === 'ip' ? this.sim.topo.rev : 0]);
    if (key === this.desktopKey && box.childElementCount) {
      if (this.desktopApp === 'browser') this.paintBrowser();
      return;
    }
    if (box.contains(document.activeElement) && (document.activeElement as HTMLElement).matches('input') && this.desktopApp === 'ip') return;
    this.desktopKey = key;
    const back = (title: string) => `<div class="app-bar"><button type="button" class="btn btn-small btn-ghost" data-app="home">Kembali ke Desktop</button><h3>${title}</h3></div>`;
    if (this.desktopApp === 'home') {
      box.innerHTML = `<div class="apps">
        <button type="button" class="app-tile" data-app="ip">${APP_ICONS.ip}<span>IP Configuration</span></button>
        <button type="button" class="app-tile" data-app="prompt">${APP_ICONS.prompt}<span>Command Prompt</span></button>
        <button type="button" class="app-tile" data-app="browser">${APP_ICONS.browser}<span>Web Browser</span></button>
      </div>
      <p class="note-muted">Desktop ${esc(d.name)}. Aplikasi di sini memakai jaringan yang sama dengan meja 3D, jadi paketnya terlihat berjalan di kabel.</p>`;
      return;
    }
    if (this.desktopApp === 'ip') {
      const nic = d.ports[0];
      box.innerHTML = `${back('IP Configuration')}
        <form class="ipconf" data-desk="ip" novalidate>
          <div class="ipconf-mode"><button type="button" class="btn btn-small btn-secondary" data-desk-act="dhcp">DHCP (IP otomatis)</button>
            <span class="note-muted">atau isi manual (Static):</span></div>
          <label for="ic-ip">IPv4 Address</label><input id="ic-ip" name="ip" class="mono" value="${esc(nic.ip ?? '')}" inputmode="decimal" autocomplete="off" />
          <label for="ic-mask">Subnet Mask</label><input id="ic-mask" name="mask" class="mono" value="${nic.prefix !== undefined ? prefixToMask(nic.prefix) : '255.255.255.0'}" inputmode="decimal" autocomplete="off" />
          <label for="ic-gw">Default Gateway</label><input id="ic-gw" name="gateway" class="mono" value="${esc(d.gateway ?? '')}" inputmode="decimal" autocomplete="off" />
          <label for="ic-dns">DNS Server</label><input id="ic-dns" name="dns" class="mono" value="${esc(d.dnsServer ?? '')}" inputmode="decimal" autocomplete="off" />
          <div class="ipconf-actions"><button type="submit" class="btn btn-primary btn-small">Simpan</button></div>
          <p class="form-error" hidden></p>
        </form>`;
      return;
    }
    if (this.desktopApp === 'prompt') {
      box.innerHTML = `${back('Command Prompt')}<div class="term" id="prompt-term"></div>`;
      this.renderTerm($('prompt-term'), d.id);
      return;
    }
    const url = this.sim.browser.deviceId === d.id ? this.sim.browser.url : $<HTMLInputElement>('url').value;
    box.innerHTML = `${back('Web Browser')}
      <form class="browser-bar" data-desk="browse" novalidate>
        <label for="br-url" class="sr-only">Alamat</label>
        <span class="field-prefix" aria-hidden="true">http://</span>
        <input id="br-url" name="url" class="mono" value="${esc(url)}" autocomplete="off" spellcheck="false" />
        <button type="submit" class="btn btn-primary btn-small">Go</button>
      </form>
      <div class="browser-view" id="browser-view"></div>`;
    const [canvas, ctx] = makeCanvas(SCREEN_W, SCREEN_H);
    canvas.className = 'browser-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Layar browser');
    $('browser-view').appendChild(canvas);
    this.browserCanvas = { canvas, ctx, key: '' };
    this.paintBrowser();
  }

  private paintBrowser(): void {
    const bc = this.browserCanvas;
    if (!bc || !bc.canvas.isConnected) return;
    const d = this.sim.topo.device(this.selectedDevice);
    const b = this.sim.browser;
    const mine = b.deviceId === d.id;
    const view = !d.powered ? { ...b, state: 'off' as const } : mine ? b : { deviceId: d.id, url: $<HTMLInputElement>('br-url')?.value ?? '', state: 'idle' as const, parts: [false, false, false] };
    const key = JSON.stringify(view);
    if (key === bc.key) return;
    bc.key = key;
    drawBrowser(bc.ctx, view);
    bc.canvas.setAttribute('aria-label', view.state === 'done' ? 'Halaman Halo dari Server Web tampil lengkap' : view.state === 'error' ? `Halaman tidak bisa dibuka. ${view.message ?? ''}` : 'Layar browser');
  }

  private bindDeviceWindow(): void {
    $('devwin-close').addEventListener('click', () => this.closeDevice());
    DW_TABS.forEach((t) => {
      const b = $(`dwt-${t}`);
      b.addEventListener('click', () => this.showDwTab(t));
      b.addEventListener('keydown', (e) => {
        const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        const visible = DW_TABS.filter((x) => !$(`dwt-${x}`).hidden);
        const next = visible[(visible.indexOf(t) + dir + visible.length) % visible.length];
        this.showDwTab(next);
        $(`dwt-${next}`).focus();
      });
    });
    $('vw-in').addEventListener('click', () => this.viewer?.zoom(0.75));
    $('vw-out').addEventListener('click', () => this.viewer?.zoom(1.3));
    $('vw-reset').addEventListener('click', () => this.viewer?.reset());
    const desk = $('desktop');
    desk.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const app = t.closest<HTMLButtonElement>('[data-app]');
      if (app) {
        this.desktopApp = app.dataset.app as typeof this.desktopApp;
        this.desktopKey = '';
        this.renderDesktop();
        (desk.querySelector('.term-in input, input, .app-tile') as HTMLElement | null)?.focus();
        return;
      }
      if (t.closest('[data-desk-act="dhcp"]')) {
        const r = this.sim.edit((tp) => tp.autoAddress(this.selectedDevice));
        this.toast(r.ok ? `DHCP: ${r.value}.` : r.reason);
        this.desktopKey = '';
        this.renderAll();
      }
    });
    desk.addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const f = new FormData(form);
      const id = this.selectedDevice;
      if (form.dataset.desk === 'browse') {
        this.browse(id, String(f.get('url') ?? ''));
        return;
      }
      if (form.dataset.desk === 'ip') {
        const err = form.querySelector<HTMLElement>('.form-error')!;
        const mask = String(f.get('mask') ?? '').trim();
        const prefix = [...Array(23)].map((_, i) => i + 8).find((p) => prefixToMask(p) === mask);
        const ip = String(f.get('ip') ?? '');
        let res: { ok: boolean; reason?: string } = { ok: true };
        if (ip.trim() && prefix === undefined) res = { ok: false, reason: `${mask} bukan subnet mask yang sah. Contoh: 255.255.255.0` };
        if (res.ok) res = this.sim.edit((t) => t.setPortIp(this.sim.topo.device(id).ports[0].id, ip, prefix ?? 24));
        if (res.ok) res = this.sim.edit((t) => t.setHostField(id, 'gateway', String(f.get('gateway') ?? '')));
        if (res.ok) res = this.sim.edit((t) => t.setHostField(id, 'dnsServer', String(f.get('dns') ?? '')));
        if (!res.ok) {
          err.textContent = res.reason ?? '';
          err.hidden = false;
          return;
        }
        err.hidden = true;
        this.toast('IP Configuration disimpan.');
        this.desktopKey = '';
        (document.activeElement as HTMLElement | null)?.blur();
        this.renderAll();
      }
    });
  }

  // Terminals: the Command Prompt on PCs and laptops, the CLI on routers and switches.

  private term(deviceId: string): TermState {
    let t = this.terms.get(deviceId);
    if (!t) {
      const d = this.sim.topo.device(deviceId);
      const host = { sim: this.sim, run: (k: 'ping' | 'lookup', id: string, target: string) => this.shellRun(k, id, target), changed: () => this.afterShellEdit() };
      const shell = d.kind === 'router' || d.kind === 'switch' ? new IosShell(deviceId, host) : new PromptShell(deviceId, host);
      t = { shell, lines: [...shell.banner()], history: [], index: 0 };
      this.terms.set(deviceId, t);
    }
    return t;
  }

  private afterShellEdit(): void {
    this.sim.edit(() => undefined);
    this.deviceKey = '';
    this.portsKey = '';
    this.sourceKey = '';
    this.renderAll();
  }

  private renderTerm(el: HTMLElement, deviceId: string): void {
    const t = this.term(deviceId);
    el.dataset.device = deviceId;
    el.innerHTML = `<pre class="term-out" role="log" aria-live="polite" aria-label="Keluaran"></pre>
      <form class="term-in"><label class="term-prompt" for="term-input-${deviceId}"></label>
        <input id="term-input-${deviceId}" autocomplete="off" spellcheck="false" autocapitalize="off" aria-label="Ketik perintah" /></form>`;
    const out = el.querySelector<HTMLElement>('.term-out')!;
    out.textContent = t.lines.join('\n');
    el.querySelector('.term-prompt')!.textContent = t.shell.prompt();
    out.scrollTop = out.scrollHeight;
    const form = el.querySelector<HTMLFormElement>('.term-in')!;
    const input = form.querySelector('input')!;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const line = input.value;
      input.value = '';
      this.termWrite(deviceId, [`${t.shell.prompt()}${line}`]);
      if (line.trim().toLowerCase() === 'cls' && t.shell instanceof PromptShell) {
        t.lines = [];
        out.textContent = '';
      } else {
        this.termWrite(deviceId, t.shell.exec(line));
      }
      if (line.trim()) {
        t.history.push(line);
        t.index = t.history.length;
      }
      el.querySelector('.term-prompt')!.textContent = t.shell.prompt();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' && t.history.length) {
        t.index = Math.max(0, t.index - 1);
        input.value = t.history[t.index] ?? '';
        e.preventDefault();
      } else if (e.key === 'ArrowDown' && t.history.length) {
        t.index = Math.min(t.history.length, t.index + 1);
        input.value = t.history[t.index] ?? '';
        e.preventDefault();
      }
    });
    out.addEventListener('click', () => input.focus());
  }

  /** Appends lines to a device's terminal and to its open view, if any. */
  private termWrite(deviceId: string, lines: string[]): void {
    if (!lines.length) return;
    const t = this.term(deviceId);
    t.lines.push(...lines);
    if (t.lines.length > 600) t.lines.splice(0, t.lines.length - 600);
    const el = document.querySelector<HTMLElement>(`.term[data-device="${CSS.escape(deviceId)}"] .term-out`);
    if (el && el.isConnected) {
      el.textContent = t.lines.join('\n');
      el.scrollTop = el.scrollHeight;
    }
  }

  /** Lines a ping or nslookup run printed since the last frame go to the terminal that started it. */
  private streamOutput(): void {
    const s = this.stream;
    if (!s.deviceId || this.sim.outputDevice !== s.deviceId || this.sim.kind === 'web') return;
    if (this.sim.output.length > s.printed) {
      this.termWrite(s.deviceId, this.sim.output.slice(s.printed));
      s.printed = this.sim.output.length;
    }
  }

  private askRemove(id: string): void {
    const d = this.sim.topo.device(id);
    const cables = d.ports.filter((p) => this.sim.topo.linkOf(p.id)).length;
    this.confirm(`Hapus ${d.name} dari meja?${cables ? ` ${cables} kabelnya ikut dicabut.` : ''}`, 'Hapus perangkat', () => {
      if (this.dwOpen() && this.selectedDevice === id) this.closeDevice();
      this.sim.removeDevice(id);
      this.terms.delete(id);
      if (this.selectedDevice === id) this.selectedDevice = [...this.sim.topo.devices.keys()][0] ?? '';
      this.toast(`${d.name} dihapus.`);
      this.deviceKey = '';
      this.renderAll();
    });
  }

  private afterTopologySwap(message: string): void {
    this.closeDevice();
    this.terms.clear();
    this.playing = false;
    this.selectedPacket = null;
    this.selectedLink = null;
    this.setPending(null);
    this.stopPlacing();
    this.renderedLog = 0;
    $('log').innerHTML = '';
    if (!this.sim.topo.has(this.selectedDevice)) this.selectedDevice = [...this.sim.topo.devices.keys()][0] ?? '';
    this.deviceKey = '';
    this.sourceKey = '';
    this.stage?.syncTopology(true);
    this.stage?.fitView(true);
    this.toast(message);
    this.renderAll();
  }

  private togglePower(id: string): void {
    const dev = this.sim.topo.device(id);
    this.sim.setPower(id, !dev.powered);
    this.toast(dev.powered ? `${dev.name} dinyalakan.` : `${dev.name} dimatikan. Kabelnya tidak lagi membawa sinyal.`);
    this.deviceKey = '';
    this.renderAll();
  }

  private askUnplug(linkId: string): void {
    const link = this.sim.topo.links.get(linkId);
    if (!link) return;
    this.selectedLink = linkId;
    this.confirm(`Kabel ${this.sim.topo.portLabel(link.a)} ke ${this.sim.topo.portLabel(link.b)}`, 'Cabut kabel', () => this.unplug(linkId), () => {
      this.selectedLink = null;
    });
  }

  private unplug(linkId: string): void {
    const link = this.sim.topo.links.get(linkId);
    if (!link) return;
    const text = `Kabel ${this.sim.topo.portLabel(link.a)} ke ${this.sim.topo.portLabel(link.b)} dicabut.`;
    this.sim.disconnect(linkId);
    this.selectedLink = null;
    this.toast(text);
    this.deviceKey = '';
    this.renderAll();
  }

  private plug(a: string, b: string): void {
    const res = this.sim.connect(a, b);
    if (res.ok) this.toast(`Kabel terpasang: ${this.sim.topo.portLabel(a)} ke ${this.sim.topo.portLabel(b)}.`);
    else this.toast(res.reason);
    this.deviceKey = '';
    this.renderAll();
  }

  private setPending(port: string | null): void {
    this.pendingPort = port;
    this.stage?.setPending(port);
  }

  private onPick(p: Pick | null): void {
    $('tooltip').hidden = true;
    if (!p) {
      if (this.pendingPort) {
        this.setPending(null);
        this.toast('Pemasangan kabel dibatalkan.');
      }
      this.closePopover();
      return;
    }
    if (p.type === 'power') {
      this.togglePower(p.deviceId);
      return;
    }
    if (p.type === 'port') {
      const topo = this.sim.topo;
      if (this.pendingPort) {
        if (this.pendingPort === p.portId) {
          this.setPending(null);
          this.toast('Pemasangan kabel dibatalkan.');
          return;
        }
        const from = this.pendingPort;
        this.setPending(null);
        this.plug(from, p.portId);
        return;
      }
      const link = topo.linkOf(p.portId);
      if (link) {
        this.askUnplug(link.id);
        return;
      }
      this.setPending(p.portId);
      this.closePopover();
      this.toast(`Kabel dari ${topo.portLabel(p.portId)}. Sekarang klik port kosong di perangkat lain. Tekan Esc untuk batal.`);
      return;
    }
    if (p.type === 'cable') {
      this.askUnplug(p.linkId);
      return;
    }
    if (p.type === 'device') {
      this.openDevice(p.deviceId);
      return;
    }
    if (p.type === 'packet') {
      this.selectedPacket = p.packetId;
      this.followLatest = false;
      this.packetKey = '';
      this.showTab('paket');
    }
  }

  private onHover(p: Pick | null, x: number, y: number): void {
    const tip = $('tooltip');
    if (!p) {
      tip.hidden = true;
      return;
    }
    const topo = this.sim.topo;
    let text = '';
    if (p.type === 'port' && topo.hasPort(p.portId)) {
      const port = topo.port(p.portId);
      const peer = topo.peer(p.portId);
      const kind = topo.deviceOf(p.portId).kind;
      const ip = kind === 'switch' ? '' : port.ip ? `, IP ${port.ip}/${port.prefix}` : ', belum diberi IP';
      text = peer
        ? `${topo.portLabel(p.portId)}${ip}. Tersambung ke ${topo.portLabel(peer)}.${topo.carrier(p.portId) ? '' : ' Tidak ada sinyal karena salah satu perangkat mati.'}`
        : this.pendingPort
          ? `${topo.portLabel(p.portId)}${ip}. Klik untuk memasang ujung kabel di sini.`
          : `${topo.portLabel(p.portId)} kosong${ip}. Klik untuk mulai memasang kabel dari sini.`;
    } else if (p.type === 'power' && topo.has(p.deviceId)) {
      const d = topo.device(p.deviceId);
      text = `Tombol power ${d.name}. Sekarang ${d.powered ? 'menyala, klik untuk mematikan' : 'mati, klik untuk menyalakan'}.`;
    } else if (p.type === 'device' && topo.has(p.deviceId)) {
      text = `${topo.device(p.deviceId).name}. Klik untuk mengatur, seret untuk memindahkan.`;
    } else if (p.type === 'cable') {
      const l = topo.links.get(p.linkId);
      if (l) text = `Kabel ${topo.portLabel(l.a)} ke ${topo.portLabel(l.b)}. Klik untuk mencabut.`;
    } else if (p.type === 'packet') {
      const pk = this.sim.packet(p.packetId);
      if (pk) text = `${pk.title}. Klik untuk membuka header-nya.`;
    }
    if (!text) {
      tip.hidden = true;
      return;
    }
    tip.textContent = text;
    tip.hidden = false;
    const host = tip.parentElement!.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = Math.min(host.width - w - 8, Math.max(8, x - host.left + 14));
    const top = y - host.top + 18 + h > host.height ? y - host.top - h - 12 : y - host.top + 18;
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(8, top))}px)`;
  }

  private confirm(title: string, action: string, run: () => void, onCancel?: () => void): void {
    $('popover-title').textContent = title;
    $('popover-action').textContent = action;
    this.popoverAction = run;
    this.popoverCancel = onCancel ?? null;
    $('popover').hidden = false;
    $('popover-action').focus();
  }

  private popoverCancel: (() => void) | null = null;

  private closePopover(): void {
    if ($('popover').hidden) return;
    $('popover').hidden = true;
    this.popoverAction = null;
    const cancel = this.popoverCancel;
    this.popoverCancel = null;
    cancel?.();
    this.selectedLink = null;
  }

  private toast(text: string): void {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      t.hidden = true;
    }, 4800);
  }

  private showTab(tab: Tab): void {
    this.tab = tab;
    for (const t of TABS) {
      const b = $(`tab-${t}`);
      b.setAttribute('aria-selected', String(t === tab));
      b.tabIndex = t === tab ? 0 : -1;
      $(`pane-${t}`).hidden = t !== tab;
    }
    this.packetKey = '';
    this.deviceKey = '';
    if (tab === 'riwayat') void this.refreshDb();
    this.renderAll();
  }

  // ------------------------------------------------------------------ device panel

  private bindDevicePanel(): void {
    const box = $('device');
    box.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      if (!b) return;
      const id = this.selectedDevice;
      const act = b.dataset.act;
      if (act === 'power') this.togglePower(id);
      else if (act === 'focus') this.stage?.focusDevice(id);
      else if (act === 'remove') this.askRemove(id);
      else if (act === 'unplug') this.askUnplug(b.dataset.link!);
      else if (act === 'auto') {
        const r = this.sim.edit((t) => t.autoAddress(id));
        this.toast(r.ok ? `IP otomatis: ${r.value}.` : r.reason);
        this.deviceKey = '';
        this.renderAll();
      } else if (act === 'del-record') {
        this.sim.edit((t) => t.removeDnsRecord(id, b.dataset.name!));
        this.deviceKey = '';
        this.renderAll();
      } else if (act === 'plug') {
        const sel = document.getElementById(`to-${b.dataset.port!}`) as HTMLSelectElement | null;
        if (!sel?.value) {
          this.toast('Pilih dulu port tujuan di daftar sebelah tombol Pasang.');
          sel?.focus();
          return;
        }
        this.plug(b.dataset.port!, sel.value);
      }
    });
    box.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.dataset.portUp) {
        const pid = input.dataset.portUp;
        this.sim.edit((t) => t.setPortDown(pid, !input.checked));
        this.toast(`${this.sim.topo.portLabel(pid)} ${input.checked ? 'aktif (no shutdown)' : 'dimatikan (shutdown)'}.`);
        this.deviceKey = '';
        this.renderAll();
        return;
      }
      if (input.dataset.service) {
        const d = this.sim.topo.device(this.selectedDevice);
        const next = { dns: !!d.services?.dns, http: !!d.services?.http, [input.dataset.service]: input.checked };
        this.sim.edit((t) => t.setServices(d.id, next));
        this.toast(`${d.name}: layanan ${input.dataset.service.toUpperCase()} ${input.checked ? 'aktif' : 'dimatikan'}.`);
        this.deviceKey = '';
        this.renderAll();
      }
    });
    box.addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const id = this.selectedDevice;
      const f = new FormData(form);
      const kind = form.dataset.form;
