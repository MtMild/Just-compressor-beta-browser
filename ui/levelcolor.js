// Level meter colours shared by the Threshold ring and the OUT meter: green when quiet, then yellow, orange, red towards 0 dB (and beyond).
export function ringColor(db) {
  const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
  const hue = db <= -30 ? 135 : db <= -12 ? lerp(135, 58, (db + 30) / 18) : db <= -4 ? lerp(58, 30, (db + 12) / 8) : lerp(30, 2, (db + 4) / 4);
  return `hsl(${hue.toFixed(0)} 82% 52%)`;
}
