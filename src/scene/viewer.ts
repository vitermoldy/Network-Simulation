// The close-up in a device's window (the "Fisik" tab): one device alone on a small turntable,
// big enough to read every port, LED and label. It follows the live network like the bench does,
// and its power control works here too. Plugged cables show as short leads leaving the sockets.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Simulator } from '../engine/sim';
import { buildPlug, cableMaterial, tube } from './cables';
import { buildDevice, refreshLive, signatureOf, type DeviceView, type Pick } from './devices';
import { SCENE_THEMES, type ThemeName } from './theme';

export class DeviceViewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
  private controls: OrbitControls;
