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
