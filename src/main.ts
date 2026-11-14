import '@fontsource-variable/host-grotesk';
import '@fontsource-variable/jetbrains-mono';
import './styles/main.css';
import { Simulator } from './engine/sim';
import { Topology } from './engine/topology';
import type { Stage } from './scene/stage';
import { App } from './ui/app';

const sim = new Simulator(new Topology(), (Math.random() * 1e9) | 0);
const app = new App(sim);
let stage: Stage | undefined;

// ?debug exposes the simulator and the 3D stage to the console, for lecturers and for the
// automated click-through check. Nothing changes for normal visitors.
if (new URLSearchParams(location.search).has('debug')) {
  (window as unknown as { __netsim: unknown }).__netsim = { sim, app, stage: () => stage };
}

void app.init(async () => {
  // Fonts first, so the printing on device faces uses the real typeface.
  const fonts = Promise.all([
