// IPv4 helpers. Addresses stay strings everywhere else; numbers are only for the math here.

export function ipToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    throw new Error(`Alamat IP tidak sah: ${ip}`);
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function maskOf(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

/** "192.168.1.10", 24 -> "192.168.1.0/24" */
export function networkOf(ip: string, prefix: number): string {
  return `${intToIp((ipToInt(ip) & maskOf(prefix)) >>> 0)}/${prefix}`;
}

export function inNetwork(ip: string, network: string): boolean {
  const [base, p] = network.split('/');
  const prefix = Number(p);
  return ((ipToInt(ip) & maskOf(prefix)) >>> 0) === ipToInt(base);
}

export function sameSubnet(a: string, b: string, prefix: number): boolean {
  return networkOf(a, prefix) === networkOf(b, prefix);
}

export function prefixOf(network: string): number {
  return Number(network.split('/')[1]);
}
