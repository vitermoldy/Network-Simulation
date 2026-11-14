// Scene colours for each theme. The devices keep their own casing colours in both themes
// (they are objects on a bench); the bench, the zones and the labels follow the page.

export type ThemeName = 'light' | 'dark';

export interface SceneTheme {
  background: number;
  floor: number;
  zone: number;
  zoneEdge: number;
  zoneActive: number;
  label: string;
  labelMuted: string;
  arrow: string;
  shadow: number;
}

export const SCENE_THEMES: Record<ThemeName, SceneTheme> = {
  light: {
    background: 0xeef0f3,
    floor: 0xe2e5ea,
    zone: 0xe9ecf0,
    zoneEdge: 0xc3c8d0,
    zoneActive: 0x1f2de6,
    label: '#0b0c0e',
    labelMuted: '#5d6470',
    arrow: '#8b929d',
    shadow: 0.16,
  },
  dark: {
    background: 0x0f1012,
    floor: 0x17181a,
    zone: 0x1d1f22,
    zoneEdge: 0x34373c,
    zoneActive: 0x5b8cff,
    label: '#eef0f3',
    labelMuted: '#a3a7ad',
    arrow: '#6d727a',
    shadow: 0.42,
  },
};

/** Physical colours: casings, LEDs, metal. */
export const MATERIAL = {
  /** Catalyst-style switch chassis. */
  slate: 0x3b424a,
  /** ISR-style router chassis. */
  graphite: 0x2c3137,
  plate: 0x9aa3ad,
  tower: 0xd6dadf,
  laptop: 0xc9ced5,
  keyboard: 0x2a2d32,
  server: 0xcfd3d9,
  bezel: 0x2b2e33,
  metal: 0x9aa1aa,
  hole: 0x050607,
  pin: 0xc9a54a,
  ledOff: 0x3a3e44,
  ledGreen: 0x22d36b,
  ledAmber: 0xffaa1c,
  ledRed: 0xe0443a,
  rocker: 0x1b1d21,
  cable: 0x3b4048,
  cableHover: 0x1f2de6,
  plug: 0xe6ebf0,
  packet: 0x1f2de6,
  packetDark: 0x5b8cff,
  lost: 0xd93a2b,
