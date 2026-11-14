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
