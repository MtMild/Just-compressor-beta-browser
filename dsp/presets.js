// Starting points assembled from general compression rules of thumb; tune by ear.
const P = (name, style, threshold, ratio, knee, attack, release, extra = {}) =>
  ({ name, params: { style, threshold, ratio, knee, attack, release, mix: 100, upward: false, ...extra } });

export const PRESETS = [
  P('Vocal Control', 'vocal', -24, 3, 12, 10, 120),
  P('Vocal Smash', 'vocal', -30, 6, 6, 5, 80),
  P('Kick Punch', 'punch', -20, 5, 4, 30, 60),
  P('Snare Crack', 'classic', -22, 6, 3, 5, 100),
  P('Bass Tighten', 'clean', -26, 4, 8, 15, 100, { sidechainHpf: 80 }),
  P('Drum Bus Glue', 'bus', -18, 2, 8, 30, 150),
  P('Parallel Drum Crush', 'punch', -36, 10, 2, 1, 120, { mix: 35 }),
  P('Mix Bus Glue', 'bus', -14, 1.5, 14, 30, 200),
  P('Mastering Gentle', 'clean', -16, 1.3, 20, 40, 300, { lookahead: 2 }),
  P('Acoustic Guitar Even', 'opto', -26, 3, 14, 20, 150),
];
