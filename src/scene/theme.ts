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
