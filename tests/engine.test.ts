import { describe, expect, it } from 'vitest';
import { inNetwork, networkOf } from '../src/engine/ip';
import { layersOf } from '../src/engine/packet';
import { computeRoutes, lookup } from '../src/engine/routing';
import { Simulator, type Scenario } from '../src/engine/sim';
import { Topology } from '../src/engine/topology';

