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
