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
