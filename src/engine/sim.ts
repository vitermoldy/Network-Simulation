// The simulator: a discrete-event clock that moves packets over cables, lets each device make its
// own decision when a packet arrives, and runs the small programs on the hosts (the browser on the
// laptop, the DNS server, the web server). Decisions use the topology as it is at that moment, so
// pulling a cable or switching a router off mid-run really loses packets and changes the route.

import { sameSubnet } from './ip';
import { BROADCAST, clonePacket, type LayerId, type Packet, type TcpFlag } from './packet';
import { computeRoutes, lookup, type Route } from './routing';
import { isClient, Topology, type Device, type Role } from './topology';

export const TIMING = {
  /** Seconds a frame spends on one cable at speed 1. */
  hop: 0.7,
  switch: 0.3,
  router: 0.4,
  host: 0.45,
  /** Routers need a moment to notice a change and agree on new routes. */
  converge: 2.5,
};

const RTO_INIT = 16;
const DNS_RTO = 11;
const ARP_RTO = 5;
const MAX_TCP_TRIES = 5;
const MAX_DNS_TRIES = 3;
const MAX_ARP_TRIES = 3;
const CLIENT_PORT = 49152;
const DNS_PORT_CLIENT = 53001;
const CLIENT_ISS = 1000;
const SERVER_ISS = 5000;
const SEGMENT = 400;

export const PAGE_PARTS: { lines: string[]; shows: string }[] = [
  {
    lines: ['HTTP/1.1 200 OK', 'Content-Type: text/html', 'Content-Length: 1200', '<header>jaringan.test</header>'],
    shows: 'kepala halaman',
  },
  {
    lines: ['<h1>Halo dari Server Web</h1>', '<p>Halaman ini dikirim server web lewat jaringan sampai ke layarmu.</p>'],
    shows: 'judul dan isi',
  },
  {
    lines: ['<footer>Dikirim dalam 3 segmen TCP</footer>', '</html>'],
    shows: 'kaki halaman',
  },
];
const RESPONSE_LEN = SEGMENT * PAGE_PARTS.length;

export type PhaseId = 'input' | 'arp' | 'dns' | 'tcp-open' | 'http-req' | 'http-res' | 'output' | 'tcp-close' | 'icmp';
export type PhaseStatus = 'waiting' | 'active' | 'done' | 'failed' | 'skipped';

export interface Phase {
  id: PhaseId;
  title: string;
  layer: string;
  role: Role;
  status: PhaseStatus;
}

/** What a run does: open a web page, ping an address, or only ask DNS for a name. */
export type RunKind = 'web' | 'ping' | 'lookup';

const PHASE_SETS: Record<RunKind, Omit<Phase, 'status'>[]> = {
  web: [
    { id: 'input', title: 'Alamat web diketik di browser', layer: 'Aplikasi', role: 'input' },
    { id: 'arp', title: 'ARP: mencari MAC gateway', layer: 'Data link', role: 'process' },
    { id: 'dns', title: 'DNS: menanyakan alamat IP', layer: 'Aplikasi, UDP', role: 'process' },
    { id: 'tcp-open', title: 'TCP: jabat tangan 3 langkah', layer: 'Transport', role: 'process' },
    { id: 'http-req', title: 'HTTP: permintaan halaman', layer: 'Aplikasi', role: 'output' },
    { id: 'http-res', title: 'HTTP: halaman dikirim balik', layer: 'Aplikasi, TCP', role: 'output' },
    { id: 'output', title: 'Halaman tampil di layar pengirim', layer: 'Aplikasi', role: 'input' },
    { id: 'tcp-close', title: 'TCP: sambungan ditutup', layer: 'Transport', role: 'process' },
  ],
  ping: [
    { id: 'input', title: 'Perintah ping diketik', layer: 'Aplikasi', role: 'input' },
    { id: 'arp', title: 'ARP: mencari MAC tujuan berikutnya', layer: 'Data link', role: 'process' },
    { id: 'dns', title: 'DNS: menanyakan alamat IP', layer: 'Aplikasi, UDP', role: 'process' },
    { id: 'icmp', title: 'ICMP: echo request dan echo reply', layer: 'Jaringan', role: 'process' },
    { id: 'output', title: 'Hasil ping tampil', layer: 'Aplikasi', role: 'input' },
  ],
  lookup: [
    { id: 'input', title: 'Perintah nslookup diketik', layer: 'Aplikasi', role: 'input' },
    { id: 'arp', title: 'ARP: mencari MAC gateway', layer: 'Data link', role: 'process' },
    { id: 'dns', title: 'DNS: menanyakan alamat IP', layer: 'Aplikasi, UDP', role: 'process' },
