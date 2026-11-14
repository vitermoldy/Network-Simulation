// Two small command interpreters for the device window, after what students type in Packet
// Tracer: a Command Prompt on PCs and laptops, and an IOS-style CLI on routers and switches.
// They read and change the same topology the 3D bench shows; ping and nslookup start a real run
// whose packets travel the cables, and their output lines arrive while it plays.

import { intToIp, maskOf, networkOf } from '../engine/ip';
import type { Simulator } from '../engine/sim';
import { longPortName, type Device, type Port } from '../engine/topology';

export interface ShellHost {
  sim: Simulator;
  /** Starts a ping or nslookup run from this device; returns a reason when it cannot. */
  run: (kind: 'ping' | 'lookup', deviceId: string, target: string) => string | undefined;
  /** Any change to settings goes through the simulator so routes are recomputed. */
  changed: () => void;
}

export interface Shell {
  prompt(): string;
  exec(line: string): string[];
  banner(): string[];
}

function maskToPrefix(mask: string): number | undefined {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(mask.trim());
  if (!m) return undefined;
  const n = ((Number(m[1]) << 24) | (Number(m[2]) << 16) | (Number(m[3]) << 8) | Number(m[4])) >>> 0;
  for (let p = 0; p <= 32; p++) if (maskOf(p) === n) return p;
  return undefined;
}

export const prefixToMask = (prefix: number) => intToIp(maskOf(prefix));
const pad = (s: string, n: number) => (s.length >= n ? `${s} ` : s + ' '.repeat(n - s.length));

// ------------------------------------------------------------------ Command Prompt (PC, laptop)

export class PromptShell implements Shell {
  constructor(private deviceId: string, private host: ShellHost) {}

  private get dev(): Device {
    return this.host.sim.topo.device(this.deviceId);
  }

  prompt(): string {
    return 'C:\\>';
  }

  banner(): string[] {
    return [`Command Prompt di ${this.dev.name}`, 'Ketik help untuk melihat perintah yang tersedia.', ''];
  }

  exec(raw: string): string[] {
    const line = raw.trim();
    if (!line) return [];
    const [cmd, ...args] = line.split(/\s+/);
    const c = cmd.toLowerCase();
    const d = this.dev;
    const nic = d.ports[0];
    if (!d.powered) return ['Perangkat mati. Nyalakan dulu lewat tombol power.'];
    if (c === 'help' || c === '?') {
      return [
        'Perintah yang tersedia:',
        '  ipconfig            alamat IP, subnet mask, dan gateway',
        '  ipconfig /all       ditambah alamat MAC dan server DNS',
        '  ping <ip|nama>      kirim 4 ICMP echo request dan tunggu balasannya',
        '  arp -a              isi cache ARP',
        '  nslookup <nama>     tanya server DNS',
        '  cls                 bersihkan layar',
      ];
    }
    if (c === 'ipconfig') {
      const all = args[0]?.toLowerCase() === '/all';
      const out = ['', 'FastEthernet0 Connection:(default port)', ''];
      if (all) out.push(`   Physical Address................: ${nic.mac.toUpperCase().replace(/:/g, '-')}`);
      out.push(`   IPv4 Address....................: ${nic.ip ?? '0.0.0.0'}`);
      out.push(`   Subnet Mask.....................: ${nic.prefix !== undefined ? prefixToMask(nic.prefix) : '0.0.0.0'}`);
      out.push(`   Default Gateway.................: ${d.gateway ?? '0.0.0.0'}`);
      if (all) out.push(`   DNS Servers.....................: ${d.dnsServer ?? '0.0.0.0'}`);
      if (!this.host.sim.topo.carrier(nic.id)) out.push('', '   Media State.....................: Media disconnected');
