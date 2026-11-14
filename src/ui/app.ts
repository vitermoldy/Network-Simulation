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

