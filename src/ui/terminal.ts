// Two small command interpreters for the device window, after what students type in Packet
// Tracer: a Command Prompt on PCs and laptops, and an IOS-style CLI on routers and switches.
// They read and change the same topology the 3D bench shows; ping and nslookup start a real run
// whose packets travel the cables, and their output lines arrive while it plays.

import { intToIp, maskOf, networkOf } from '../engine/ip';
import type { Simulator } from '../engine/sim';
import { longPortName, type Device, type Port } from '../engine/topology';

export interface ShellHost {
  sim: Simulator;
  /** Starts a ping or nslookup run from this device; returns a reason when it cannot. */
