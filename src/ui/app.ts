// The page around the 3D bench: the request form, the device palette, the run controls, and the
// four panels (Alur, Paket, Perangkat, Riwayat). The simulator is the single source of truth; the
// panels redraw when its version number moves.

import * as api from '../data/api';
import { layersOf, readsUpTo, type Packet } from '../engine/packet';
import { type LogEntry, type PhaseStatus, type Scenario, Simulator } from '../engine/sim';
import { isClient, KIND_LABEL, roleOf, type DeviceKind, type Role } from '../engine/topology';
import type { Pick } from '../scene/devices';
import type { Stage, StageEvents } from '../scene/stage';
import type { DeviceViewer } from '../scene/viewer';
