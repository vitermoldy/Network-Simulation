// A packet as it sits on the wire: every header from Ethernet up to the application.

export const BROADCAST = 'ff:ff:ff:ff:ff:ff';

export type Flow = 'arp' | 'dns' | 'tcp' | 'http' | 'icmp';
export type TcpFlag = 'SYN' | 'ACK' | 'PSH' | 'FIN' | 'RST';

export interface EthHeader {
  src: string;
  dst: string;
  type: 'ARP' | 'IPv4';
}

export interface ArpBody {
  op: 'request' | 'reply';
  senderMac: string;
  senderIp: string;
  targetMac: string;
  targetIp: string;
}

export interface IpHeader {
  src: string;
  dst: string;
  ttl: number;
  proto: 'UDP' | 'TCP' | 'ICMP';
}

export interface IcmpBody {
  type: 'echo-request' | 'echo-reply';
  id: number;
  seq: number;
}

export interface UdpHeader {
  src: number;
  dst: number;
}

export interface TcpHeader {
  src: number;
  dst: number;
  seq: number;
  ack: number;
  flags: TcpFlag[];
  len: number;
}

export interface DnsBody {
  txid: number;
  question: string;
  answer?: string;
  rcode?: 'NOERROR' | 'NXDOMAIN';
}

export interface AppBody {
  proto: 'DNS' | 'HTTP';
  lines: string[];
  dns?: DnsBody;
  /** HTTP response segments: which part of the page this one carries (1-based). */
  part?: number;
  parts?: number;
}

export interface Packet {
  id: number;
  flow: Flow;
  /** Short tag that rides above the packet in 3D. */
  label: string;
  /** One line for the log and the inspector. */
  title: string;
  eth: EthHeader;
  arp?: ArpBody;
  ip?: IpHeader;
  icmp?: IcmpBody;
  udp?: UdpHeader;
  tcp?: TcpHeader;
  app?: AppBody;
  size: number;
  /** 0 for the first transmission, 1 for the first resend, and so on. */
  retry: number;
  /** Cables travelled so far. */
  hops: number;
  /** Set on the extra copies a switch makes when it floods. */
  copyOf?: number;
}

export function clonePacket(p: Packet): Packet {
  return {
    ...p,
    eth: { ...p.eth },
    arp: p.arp && { ...p.arp },
    ip: p.ip && { ...p.ip },
    icmp: p.icmp && { ...p.icmp },
    udp: p.udp && { ...p.udp },
    tcp: p.tcp && { ...p.tcp, flags: [...p.tcp.flags] },
    app: p.app && { ...p.app, lines: [...p.app.lines], dns: p.app.dns && { ...p.app.dns } },
  };
}

export type LayerId = 7 | 4 | 3 | 2 | 1;

export interface LayerRow {
  layer: LayerId;
  osi: string;
  tcpip: string;
  proto: string;
  fields: [string, string][];
}

export const LAYER_NAMES: Record<LayerId, { osi: string; tcpip: string }> = {
  7: { osi: 'Aplikasi (lapisan 5 sampai 7)', tcpip: 'Aplikasi' },
  4: { osi: 'Transport (lapisan 4)', tcpip: 'Transport' },
  3: { osi: 'Jaringan (lapisan 3)', tcpip: 'Internet' },
  2: { osi: 'Data link (lapisan 2)', tcpip: 'Akses jaringan' },
  1: { osi: 'Fisik (lapisan 1)', tcpip: 'Akses jaringan' },
};

/** Headers from the top of the stack down, the way the sender wraps them. */
export function layersOf(p: Packet, wire: string): LayerRow[] {
  const rows: LayerRow[] = [];
  const row = (layer: LayerId, proto: string, fields: [string, string][]) =>
    rows.push({ layer, ...LAYER_NAMES[layer], proto, fields });

  if (p.app) {
    const f: [string, string][] = [];
    if (p.app.dns) {
      f.push(['ID transaksi', String(p.app.dns.txid)], ['Pertanyaan', `${p.app.dns.question} (A)`]);
      if (p.app.dns.rcode) f.push(['Status', p.app.dns.rcode]);
      if (p.app.dns.answer) f.push(['Jawaban', p.app.dns.answer]);
    } else {
      p.app.lines.forEach((l, i) => f.push([i === 0 ? 'Baris awal' : 'Isi', l]));
      if (p.app.part) f.push(['Bagian', `${p.app.part} dari ${p.app.parts}`]);
    }
    row(7, p.app.proto, f);
  }
  if (p.tcp) {
    row(4, 'TCP', [
      ['Port asal', String(p.tcp.src)],
      ['Port tujuan', String(p.tcp.dst)],
      ['Flag', p.tcp.flags.join(', ')],
      ['Nomor urut (SEQ)', String(p.tcp.seq)],
      ['Nomor ACK', p.tcp.flags.includes('ACK') ? String(p.tcp.ack) : '-'],
      ['Panjang data', `${p.tcp.len} byte`],
    ]);
  } else if (p.udp) {
    row(4, 'UDP', [
      ['Port asal', String(p.udp.src)],
      ['Port tujuan', String(p.udp.dst)],
    ]);
  }
  if (p.icmp) {
    row(3, 'ICMP', [
      ['Jenis', p.icmp.type === 'echo-request' ? 'Echo request (type 8)' : 'Echo reply (type 0)'],
      ['Identifier', String(p.icmp.id)],
      ['Nomor urut', String(p.icmp.seq)],
      ['Data', '32 byte'],
