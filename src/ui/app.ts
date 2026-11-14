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
