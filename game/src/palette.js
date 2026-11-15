// The look plan, in one place. Six neutrals, one accent, and one colour per team.
// Lighting makes every shade the game needs, so no other colour appears in the code.
// The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#0e1218',
  surface: '#1b212b',
  hairline: '#2c3542',
  ink: '#ece7db',
  muted: '#9aa3ad',
  accent: '#f0a830',
  vanguard: '#35c4a8',
  ember: '#e06a3a',
};

export function shade(name) {
  return PALETTE[name];
}
