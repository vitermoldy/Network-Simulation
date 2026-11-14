import '@fontsource-variable/host-grotesk';
import '@fontsource-variable/jetbrains-mono';
import './styles/main.css';
import { Simulator } from './engine/sim';
import { Topology } from './engine/topology';
import type { Stage } from './scene/stage';
import { App } from './ui/app';

const sim = new Simulator(new Topology(), (Math.random() * 1e9) | 0);
