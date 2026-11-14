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
      return [...out, ''];
    }
    if (c === 'arp') {
      if (args[0] !== '-a') return ['Gunakan: arp -a'];
      const cache = [...this.host.sim.arpCache(d.id)];
      if (!cache.length) return ['No ARP Entries Found'];
      return ['  Internet Address      Physical Address      Type', ...cache.map(([ip, mac]) => `  ${pad(ip, 22)}${pad(mac.replace(/:/g, '-'), 22)}dynamic`)];
    }
    if (c === 'ping') {
      if (!args[0]) return ['Gunakan: ping <alamat IP atau nama>, misalnya ping 192.168.1.1'];
      const why = this.host.run('ping', d.id, args[0]);
      return why ? [why] : [''];
    }
    if (c === 'nslookup') {
      if (!args[0]) return ['Gunakan: nslookup <nama>, misalnya nslookup www.jaringan.test'];
      const why = this.host.run('lookup', d.id, args[0]);
      return why ? [why] : [''];
    }
    if (c === 'tracert' || c === 'telnet' || c === 'ssh' || c === 'ftp') return [`${cmd} belum ada di simulasi ini. Coba ping atau nslookup.`];
    return [`Invalid Command. Ketik help untuk melihat perintah.`];
  }
}

// ------------------------------------------------------------------ IOS-style CLI (router, switch)

type Mode = 'user' | 'priv' | 'config' | 'if';

interface Command {
  words: string[];
  help: string;
  run: (args: string[]) => string[];
}

export class IosShell implements Shell {
  private mode: Mode = 'user';
  private iface?: string;

  constructor(private deviceId: string, private host: ShellHost) {}

  private get dev(): Device {
    return this.host.sim.topo.device(this.deviceId);
  }

  private get hostname(): string {
    return this.dev.name.replace(/\s+/g, '') || 'Router';
  }

  prompt(): string {
    const h = this.hostname;
    if (this.mode === 'user') return `${h}>`;
    if (this.mode === 'priv') return `${h}#`;
    if (this.mode === 'config') return `${h}(config)#`;
    return `${h}(config-if)#`;
  }

  banner(): string[] {
    const d = this.dev;
    const kind = d.kind === 'router' ? `${d.ports.length} port GigabitEthernet` : '24 port FastEthernet dan 2 port GigabitEthernet';
    return [
      `Simulasi Jaringan, CLI gaya IOS`,
      `Perangkat ${d.name}: ${d.kind === 'router' ? 'router' : 'switch'} dengan ${kind}.`,
      'Ketik ? untuk melihat perintah di mode ini. Singkatan seperti en, conf t, int g0/1, no shut bisa dipakai.',
      '',
      'Press RETURN to get started!',
      '',
    ];
  }

  private findPort(raw: string): Port | undefined {
    const s = raw.replace(/\s+/g, '').toLowerCase();
    const m = /^(g|gi|gig|giga|gigabit|gigabitethernet|f|fa|fas|fast|fastethernet)(\d+\/\d+)$/.exec(s);
    if (!m) return undefined;
    const giga = m[1].startsWith('g');
    return this.dev.ports.find((p) => {
      const n = p.name.toLowerCase();
      return giga ? (n === `g${m[2]}` || n === `gi${m[2]}`) : n === `fa${m[2]}`;
    });
  }

  private commands(): Command[] {
    const d = this.dev;
    const sim = this.host.sim;
    const topo = sim.topo;
    const isRouter = d.kind === 'router';
    const show: Command[] = [
      {
        words: ['show', 'ip', 'interface', 'brief'], help: 'ringkasan port, IP, dan statusnya',
        run: () => [
          'Interface              IP-Address      OK? Method Status                Protocol',
          ...d.ports.map((p) => {
            const status = p.down ? 'administratively down' : topo.carrier(p.id) ? 'up' : 'down';
            const proto = !p.down && topo.carrier(p.id) ? 'up' : 'down';
            return `${pad(longPortName(p.name), 23)}${pad(p.ip ?? 'unassigned', 16)}YES ${pad(p.ip ? 'manual' : 'unset', 7)}${pad(status, 22)}${proto}`;
          }),
        ],
      },
      {
        words: ['show', 'running-config'], help: 'konfigurasi yang sedang dipakai',
        run: () => {
          const out = ['Building configuration...', '', 'Current configuration:', '!', `hostname ${this.hostname}`, '!'];
          for (const p of d.ports) {
            out.push(`interface ${longPortName(p.name)}`);
            if (p.ip && p.prefix !== undefined) out.push(` ip address ${p.ip} ${prefixToMask(p.prefix)}`);
            else if (isRouter) out.push(' no ip address');
            if (p.down) out.push(' shutdown');
            out.push('!');
          }
          if (isRouter) out.push('router ospf 1', ' network 0.0.0.0 255.255.255.255 area 0', '!');
          return [...out, 'end'];
        },
      },
      {
        words: ['show', 'version'], help: 'jenis perangkat dan jumlah port',
        run: () => [`${d.name}, ${isRouter ? 'router' : 'switch'} simulasi`, `${d.ports.length} port, MAC dasar ${d.ports[0].mac}`, `Status: ${d.powered ? 'menyala' : 'mati'}`],
      },
    ];
    if (isRouter) {
      show.push({
        words: ['show', 'ip', 'route'], help: 'tabel routing',
        run: () => {
          const routes = sim.routes.get(d.id) ?? [];
          const out = ['Codes: C - connected, O - OSPF (link-state di simulasi ini)', '', 'Gateway of last resort is not set', ''];
          for (const r of routes) {
            if (!topo.hasPort(r.portId)) continue;
            const port = longPortName(topo.port(r.portId).name);
            out.push(r.type === 'C' ? `C    ${r.network} is directly connected, ${port}` : `O    ${r.network} [110/${r.cost}] via ${r.nextHop}, ${port}`);
          }
          if (!routes.length) out.push('(kosong: belum ada port yang up dengan alamat IP)');
          if (sim.converging) out.push('', '% Rute sedang dihitung ulang setelah ada perubahan.');
          return out;
        },
      });
      show.push({
        words: ['show', 'arp'], help: 'cache ARP router',
        run: () => {
          const cache = [...sim.arpCache(d.id)];
          return ['Protocol  Address          Hardware Addr       Interface', ...cache.map(([ip, mac]) => `Internet  ${pad(ip, 17)}${pad(mac, 20)}-`), ...(cache.length ? [] : ['(kosong)'])];
        },
      });
    } else {
      show.push({
        words: ['show', 'mac', 'address-table'], help: 'tabel MAC switch',
        run: () => {
          const table = [...sim.macTable(d.id)].filter(([, p]) => topo.hasPort(p));
          return ['          Mac Address Table', '-------------------------------------------', '', 'Vlan    Mac Address       Type        Ports', '----    -----------       --------    -----',
            ...table.map(([mac, p]) => `   1    ${pad(mac, 18)}DYNAMIC     ${topo.port(p).name}`), ...(table.length ? [] : ['(kosong: belum ada frame yang lewat)'])];
        },
      });
    }
    const ping: Command = {
      words: ['ping'], help: 'ping <alamat IP>',
      run: (args) => {
        if (!isRouter) return ['% Switch di simulasi ini tidak punya alamat IP, jadi tidak bisa ping. Coba dari router atau PC.'];
        if (!args[0] || !/^\d+\.\d+\.\d+\.\d+$/.test(args[0])) return ['% Gunakan: ping <alamat IP>, misalnya ping 10.0.12.2'];
        const why = this.host.run('ping', d.id, args[0]);
        return why ? [why] : [''];
      },
    };
    const help = (list: Command[]) => (): string[] => list.map((c) => `  ${pad(c.words.join(' '), 32)}${c.help}`);

    if (this.mode === 'user') {
      const list: Command[] = [
        { words: ['enable'], help: 'masuk mode privileged (#)', run: () => ((this.mode = 'priv'), []) },
        ...show, ping,
        { words: ['exit'], help: 'keluar', run: () => ['', `${this.hostname} con0 is now available`, '', 'Press RETURN to get started.'] },
      ];
      return [...list, { words: ['?'], help: '', run: help(list) }];
    }
    if (this.mode === 'priv') {
      const list: Command[] = [
        { words: ['configure', 'terminal'], help: 'masuk mode konfigurasi', run: () => ((this.mode = 'config'), ['Enter configuration commands, one per line.  End with CNTL/Z.']) },
        { words: ['disable'], help: 'kembali ke mode user (>)', run: () => ((this.mode = 'user'), []) },
        ...show, ping,
        { words: ['exit'], help: 'kembali ke mode user (>)', run: () => ((this.mode = 'user'), []) },
      ];
      return [...list, { words: ['?'], help: '', run: help(list) }];
    }
    if (this.mode === 'config') {
      const list: Command[] = [
        {
          words: ['hostname'], help: 'hostname <nama>: ganti nama perangkat',
          run: (args) => {
            if (!args[0]) return ['% Incomplete command.'];
            const r = topo.rename(d.id, args.join(' '));
            this.host.changed();
            return r.ok ? [] : [`% ${r.reason}`];
          },
        },
        {
          words: ['interface'], help: `interface <port>, misalnya ${d.ports[0].name}`,
          run: (args) => {
            const p = this.findPort(args.join(''));
            if (!p) return [`% Port tidak dikenal. Port di perangkat ini: ${d.ports.map((x) => x.name).join(', ')}`];
            this.iface = p.id;
            this.mode = 'if';
            return [];
          },
        },
        { words: ['exit'], help: 'kembali ke mode privileged (#)', run: () => ((this.mode = 'priv'), []) },
        { words: ['end'], help: 'kembali ke mode privileged (#)', run: () => ((this.mode = 'priv'), []) },
      ];
      return [...list, { words: ['?'], help: '', run: help(list) }];
    }
    // Interface mode.
    const port = this.iface ? topo.port(this.iface) : undefined;
    const list: Command[] = [
      {
        words: ['ip', 'address'], help: 'ip address <IP> <subnet mask>',
        run: (args) => {
          if (!isRouter) return ['% Port switch tidak diberi IP di simulasi ini.'];
          if (args.length < 2) return ['% Incomplete command. Contoh: ip address 10.0.50.1 255.255.255.0'];
          const prefix = maskToPrefix(args[1]);
          if (prefix === undefined) return [`% ${args[1]} bukan subnet mask yang sah. Contoh: 255.255.255.0`];
          const r = topo.setPortIp(port!.id, args[0], prefix);
          this.host.changed();
          return r.ok ? [] : [`% ${r.reason}`];
        },
      },
      {
        words: ['no', 'ip', 'address'], help: 'hapus IP port ini',
        run: () => {
          topo.setPortIp(port!.id, '', 24);
          this.host.changed();
          return [];
        },
      },
      {
        words: ['shutdown'], help: 'matikan port ini secara administratif',
        run: () => {
          topo.setPortDown(port!.id, true);
          this.host.changed();
          return [`%LINK-5-CHANGED: Interface ${longPortName(port!.name)}, changed state to administratively down`];
        },
      },
      {
        words: ['no', 'shutdown'], help: 'nyalakan port ini',
        run: () => {
          topo.setPortDown(port!.id, false);
          this.host.changed();
          const up = topo.carrier(port!.id);
          return [`%LINK-5-CHANGED: Interface ${longPortName(port!.name)}, changed state to ${up ? 'up' : 'down'}`, ...(up ? [`%LINEPROTO-5-UPDOWN: Line protocol on Interface ${longPortName(port!.name)}, changed state to up`] : [])];
        },
      },
      {
        words: ['interface'], help: 'pindah ke port lain',
        run: (args) => {
          const p = this.findPort(args.join(''));
          if (!p) return ['% Port tidak dikenal.'];
          this.iface = p.id;
          return [];
        },
      },
      { words: ['exit'], help: 'kembali ke mode konfigurasi', run: () => ((this.mode = 'config'), []) },
      { words: ['end'], help: 'kembali ke mode privileged (#)', run: () => ((this.mode = 'priv'), []) },
    ];
    return [...list, { words: ['?'], help: '', run: help(list) }];
  }

  exec(raw: string): string[] {
    const line = raw.trim();
    if (!this.dev.powered) return ['% Perangkat mati. Nyalakan dulu lewat tombol power.'];
    if (!line) return [];
    // "do show ..." from configuration modes, as in IOS.
    let tokens = line.split(/\s+/);
    let cmds = this.commands();
