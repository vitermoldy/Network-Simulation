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
