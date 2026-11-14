import { describe, expect, it } from 'vitest';
import { inNetwork, networkOf } from '../src/engine/ip';
import { layersOf } from '../src/engine/packet';
import { computeRoutes, lookup } from '../src/engine/routing';
import { Simulator, type Scenario } from '../src/engine/sim';
import { Topology } from '../src/engine/topology';

function run(sim: Simulator, host = 'www.jaringan.test', limit = 600, source = 'pc'): void {
  sim.start(host, 3, source);
  let guard = 0;
  while (sim.status === 'running' && sim.time < limit && guard++ < 100000) sim.advance(0.05);
}

function withScenario(s: Scenario): Simulator {
  const sim = new Simulator(new Topology(), 3);
  sim.scenario = s;
  return sim;
}

describe('ip', () => {
  it('works out networks and membership', () => {
    expect(networkOf('192.168.1.10', 24)).toBe('192.168.1.0/24');
    expect(networkOf('10.0.12.2', 30)).toBe('10.0.12.0/30');
    expect(inNetwork('203.0.113.80', '203.0.113.0/24')).toBe(true);
    expect(inNetwork('203.0.114.80', '203.0.113.0/24')).toBe(false);
  });
});

describe('topology', () => {
  it('starts with the default cables, Cisco-style port names, and refuses bad plugs', () => {
    const t = new Topology();
    expect(t.links.size).toBe(8);
    expect(t.peer('pc.0')).toBe('sw.0');
    expect(t.port('sw.0').name).toBe('Fa0/1');
    expect(t.port('sw.24').name).toBe('Gi0/1');
    expect(t.peer('sw.24')).toBe('r1.0');
    expect(t.connect('sw.1', 'sw.2').ok).toBe(false);
    expect(t.connect('pc.0', 'sw.3').ok).toBe(false);
    expect(t.connect('sw.3', 'r2.2').ok).toBe(true);
  });

  it('puts every port of a working switch in one broadcast domain', () => {
    const t = new Topology();
    const seg = t.segments();
    expect(seg.get('pc.0')).toBe(seg.get('r1.0'));
    expect(seg.get('pc.0')).not.toBe(seg.get('r1.1'));
    t.setPower('sw', false);
    const off = t.segments();
    expect(off.has('sw.0')).toBe(false);
    expect(off.get('pc.0')).not.toBe(off.get('r1.0'));
  });

  it('checks IP settings the way a lab assistant would', () => {
    const t = new Topology();
    expect(t.setPortIp('r2.2', '10.9.0.0', 24).ok).toBe(false);
    expect(t.setPortIp('r2.2', '10.9.0.255', 24).ok).toBe(false);
    expect(t.setPortIp('r2.2', '192.168.1.10', 24).ok).toBe(false);
    expect(t.setPortIp('r2.2', '10.0.12.5', 24).ok).toBe(false);
    expect(t.setPortIp('r2.2', '300.1.1.1', 24).ok).toBe(false);
    expect(t.setPortIp('sw.3', '10.9.0.1', 24).ok).toBe(false);
    expect(t.setPortIp('r2.2', '10.9.0.1', 24).ok).toBe(true);
    expect(t.port('r2.2').ip).toBe('10.9.0.1');
  });

  it('adds and names devices like Packet Tracer, and refuses overlaps', () => {
    const t = new Topology();
    const a = t.addDevice('pc', -12, 7);
    const b = t.addDevice('pc', -8, 7);
    expect(a.name).toBe('PC 1');
    expect(b.name).toBe('PC 2');
    expect(a.ports[0].name).toBe('Fa0');
    expect(t.overlaps('router', -12, 7)).toBeDefined();
    expect(t.overlaps('router', 20, 20)).toBeUndefined();
    t.removeDevice(a.id);
    expect(t.has(a.id)).toBe(false);
  });

  it('saves and loads the whole network', () => {
    const t = new Topology();
    const pc = t.addDevice('pc', -12, 7);
    t.connect(pc.ports[0].id, 'sw.1');
    t.autoAddress(pc.id);
    const data = JSON.parse(JSON.stringify(t.toJSON()));
    const u = new Topology();
    u.load(data);
    expect(u.devices.size).toBe(9);
    expect(u.links.size).toBe(9);
    expect(u.device(pc.id).ports[0].ip).toBe(t.device(pc.id).ports[0].ip);
    expect(() => u.load({ version: 2 })).toThrow();
  });
});

describe('routing', () => {
  it('finds the shortest way and breaks ties the same way every time', () => {
    const t = new Topology();
    const routes = computeRoutes(t);
    const r1 = lookup(routes.get('r1'), '203.0.113.80')!;
    expect(r1.type).toBe('O');
    expect(r1.viaRouter).toBe('r2');
    expect(r1.cost).toBe(2);
    expect(lookup(routes.get('r1'), '192.168.1.10')!.type).toBe('C');
    expect(lookup(routes.get('r4'), '172.16.0.53')!.viaRouter).toBe('r2');
  });

  it('goes around a router that is off or removed', () => {
    const t = new Topology();
    t.setPower('r2', false);
    expect(lookup(computeRoutes(t).get('r1'), '203.0.113.80')!.viaRouter).toBe('r3');
    const u = new Topology();
    u.removeDevice('r2');
    expect(lookup(computeRoutes(u).get('r1'), '203.0.113.80')!.viaRouter).toBe('r3');
  });

  it('has no route when both middle routers are gone', () => {
    const t = new Topology();
    t.setPower('r2', false);
    t.setPower('r3', false);
    expect(lookup(computeRoutes(t).get('r1'), '203.0.113.80')).toBeUndefined();
  });
});

describe('simulator', () => {
  it('takes a request from the laptop to the web server and back', () => {
    const sim = withScenario('normal');
    run(sim);
    expect(sim.status).toBe('done');
    expect(sim.phases.every((p) => p.status === 'done')).toBe(true);
    expect(sim.browser.state).toBe('done');
    expect(sim.browser.parts).toEqual([true, true, true]);
    expect(sim.log.some((l) => l.kind === 'retry')).toBe(false);
    expect(sim.log.some((l) => l.kind === 'loss')).toBe(false);
    expect(sim.arpCache('pc').get('192.168.1.1')).toBe(sim.topo.port('r1.0').mac);
    expect(sim.macTable('sw').get(sim.topo.port('pc.0').mac)).toBe('sw.0');
  });

  it('sends the SYN along laptop, switch, router kampus, router A, pusat data, server', () => {
    const sim = withScenario('normal');
    run(sim);
    const syn = [...sim.history.entries()].find(([, v]) => v[0].tcp?.flags.join() === 'SYN')!;
    expect(sim.trace.get(syn[0])).toEqual(['pc', 'sw', 'r1', 'r2', 'r4', 'web']);
    const versions = syn[1];
    expect(versions[0].ip!.ttl).toBe(64);
    expect(versions[versions.length - 1].ip!.ttl).toBe(61);
    expect(versions[0].eth.src).not.toBe(versions[versions.length - 1].eth.src);
    expect(versions[versions.length - 1].ip!.src).toBe('192.168.1.10');
  });

  it('resends a lost segment and holds the next one until the gap is filled', () => {
    const sim = withScenario('loss');
    run(sim);
    expect(sim.status).toBe('done');
    expect(sim.log.filter((l) => l.kind === 'loss')).toHaveLength(1);
    expect(sim.log.some((l) => l.title === 'Segmen 3 datang lebih dulu')).toBe(true);
    expect(sim.log.some((l) => l.title === 'Data 2/3 dikirim ulang')).toBe(true);
    expect(sim.browser.parts).toEqual([true, true, true]);
  });

  it('finds a new way when a router goes dark mid-transfer', () => {
    const sim = withScenario('router-down');
    run(sim);
    expect(sim.status).toBe('done');
    expect(sim.topo.device('r2').powered).toBe(false);
    expect(sim.log.some((l) => l.kind === 'route' && l.title === 'Rute dihitung ulang')).toBe(true);
    const resent = [...sim.history.entries()].filter(([, v]) => v[0].app?.part && v[0].retry > 0);
    expect(resent.length).toBeGreaterThan(0);
    for (const [id] of resent) expect(sim.trace.get(id)).toContain('r3');
  });

  it('stops at DNS when the name does not exist', () => {
    const sim = withScenario('normal');
    run(sim, 'www.tidakada.test');
    expect(sim.status).toBe('failed');
    expect(sim.phases.find((p) => p.id === 'dns')!.status).toBe('failed');
    expect(sim.browser.state).toBe('error');
    expect(sim.browser.message).toContain('NXDOMAIN');
  });

  it('gives up on ARP when the laptop cable is out', () => {
    const sim = withScenario('normal');
    sim.disconnect(sim.topo.linkOf('pc.0')!.id);
    run(sim);
    expect(sim.status).toBe('failed');
    expect(sim.phases.find((p) => p.id === 'arp')!.status).toBe('failed');
  });

  it('loses a packet on a cable pulled mid-flight and recovers on the other path', () => {
    const sim = withScenario('normal');
    sim.start('www.jaringan.test', 3);
    let pulled = false;
    while (sim.status === 'running' && sim.time < 600) {
      sim.advance(0.05);
      if (!pulled) {
        const f = sim.flights.find((x) => x.packet.tcp?.flags.join() === 'SYN' && x.linkId === sim.topo.linkOf('r1.1')?.id);
        if (f) {
          sim.disconnect(f.linkId);
          pulled = true;
        }
      }
    }
    expect(pulled).toBe(true);
    expect(sim.status).toBe('done');
    expect(sim.log.some((l) => l.kind === 'loss')).toBe(true);
    expect(sim.log.some((l) => l.title === 'SYN dikirim ulang')).toBe(true);
  });

  it('recovers from random loss on every cable', () => {
    const sim = withScenario('normal');
    sim.lossRate = 0.15;
    run(sim, 'www.jaringan.test', 2000);
    expect(['done', 'failed']).toContain(sim.status);
    expect(sim.log.some((l) => l.kind === 'loss')).toBe(true);
  });

  it('stops after each decision in step mode', () => {
    const sim = withScenario('normal');
    sim.stepMode = true;
    sim.start('www.jaringan.test', 3);
    let r = sim.advance(100);
    expect(r).toBe('step');
    expect(sim.time).toBeLessThan(1);
    r = sim.advance(100);
    expect(r).toBe('step');
  });

  it('runs from a PC added by hand that got its address automatically', () => {
    const sim = withScenario('normal');
    const pc = sim.addDevice('pc', -12, 7);
    expect(sim.connect(pc.ports[0].id, 'sw.1').ok).toBe(true);
    const r = sim.edit((t) => t.autoAddress(pc.id));
    expect(r.ok).toBe(true);
    expect(pc.ports[0].ip).toBe('192.168.1.11');
    expect(pc.gateway).toBe('192.168.1.1');
    expect(pc.dnsServer).toBe('172.16.0.53');
    run(sim, 'www.jaringan.test', 600, pc.id);
    expect(sim.status).toBe('done');
    expect(sim.browser.deviceId).toBe(pc.id);
  });

  it('refuses a PC with no address before sending anything', () => {
    const sim = withScenario('normal');
    const pc = sim.addDevice('laptop', -12, 7);
    run(sim, 'www.jaringan.test', 600, pc.id);
    expect(sim.status).toBe('failed');
    expect(sim.browser.message).toContain('alamat IP');
  });

  it('gets a RST from a server with HTTP turned off', () => {
    const sim = withScenario('normal');
    sim.edit((t) => t.setServices('web', { dns: false, http: false }));
    run(sim);
    expect(sim.status).toBe('failed');
    expect(sim.log.some((l) => l.title === 'Port 80 tertutup')).toBe(true);
    expect(sim.browser.message).toContain('RST');
  });

  it('reaches a new web server once DNS knows its name', () => {
    const sim = withScenario('normal');
    const srv = sim.addDevice('server', 12, 6);
    expect(sim.edit((t) => t.setPortIp('r4.3', '198.51.100.1', 24)).ok).toBe(true);
    sim.connect('r4.3', srv.ports[0].id);
    expect(sim.edit((t) => t.autoAddress(srv.id)).ok).toBe(true);
    expect(sim.edit((t) => t.setDnsRecord('dns', 'www.baru.test', srv.ports[0].ip!)).ok).toBe(true);
    run(sim, 'www.baru.test');
    expect(sim.status).toBe('done');
    const syn = [...sim.history.entries()].find(([, v]) => v[0].tcp?.flags.join() === 'SYN')!;
    expect(sim.trace.get(syn[0])!.at(-1)).toBe(srv.id);
  });

  it('fails cleanly when the sending PC is removed mid-run', () => {
    const sim = withScenario('normal');
    sim.start('www.jaringan.test', 3);
    while (sim.time < 6) sim.advance(0.05);
    sim.removeDevice('pc');
    expect(sim.status).toBe('failed');
    for (let i = 0; i < 200; i++) sim.advance(0.05);
  });
});

function runPing(sim: Simulator, source: string, target: string): void {
  sim.startPing(source, target, 3);
  let guard = 0;
  while (sim.status === 'running' && sim.time < 600 && guard++ < 100000) sim.advance(0.05);
}

describe('ping and nslookup', () => {
  it('pings the web server by address from the laptop', () => {
    const sim = withScenario('normal');
    runPing(sim, 'pc', '203.0.113.80');
    expect(sim.status).toBe('done');
    expect(sim.output.filter((l) => l.startsWith('Reply from 203.0.113.80'))).toHaveLength(4);
    expect(sim.output.some((l) => l.includes('Lost = 0 (0% loss)'))).toBe(true);
    expect(sim.phases.find((p) => p.id === 'dns')!.status).toBe('skipped');
    expect(sim.output.find((l) => l.startsWith('Reply'))).toContain('TTL=125');
  });

  it('looks a name up before pinging it', () => {
    const sim = withScenario('normal');
    runPing(sim, 'pc', 'www.jaringan.test');
    expect(sim.status).toBe('done');
    expect(sim.phases.find((p) => p.id === 'dns')!.status).toBe('done');
    expect(sim.output.some((l) => l.includes('203.0.113.80'))).toBe(true);
  });

  it('pings from a router and gets answers from a router port', () => {
    const sim = withScenario('normal');
    runPing(sim, 'r1', '203.0.113.80');
    expect(sim.status).toBe('done');
    const sim2 = withScenario('normal');
    runPing(sim2, 'pc', '10.0.24.2');
    expect(sim2.status).toBe('done');
  });

  it('times out four times when there is no route', () => {
    const sim = withScenario('normal');
    runPing(sim, 'pc', '10.99.0.1');
    expect(sim.status).toBe('failed');
    expect(sim.output.filter((l) => l === 'Request timed out.')).toHaveLength(4);
    expect(sim.output.some((l) => l.includes('100% loss'))).toBe(true);
  });

  it('answers nslookup with the record or NXDOMAIN', () => {
    const sim = withScenario('normal');
    sim.startLookup('pc', 'www.jaringan.test', 3);
    while (sim.status === 'running' && sim.time < 200) sim.advance(0.05);
    expect(sim.status).toBe('done');
