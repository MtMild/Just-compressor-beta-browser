export const dbToLin = (db) => Math.pow(10, db / 20);
export const linToDb = (lin) => (lin <= 1e-6 ? -120 : 20 * Math.log10(lin));
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
