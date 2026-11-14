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
