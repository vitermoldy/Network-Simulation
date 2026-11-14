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
