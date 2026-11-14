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
