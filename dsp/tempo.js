// Note values for Tempo Sync, from short to long. beats = length in quarter notes (T = triplet = 2/3, D = dotted = 3/2).
export const NOTES = [
  { label: '1/32', beats: 0.125 }, { label: '1/16T', beats: 1 / 6 }, { label: '1/16', beats: 0.25 }, { label: '1/8T', beats: 1 / 3 },
  { label: '1/8', beats: 0.5 }, { label: '1/4T', beats: 2 / 3 }, { label: '1/8D', beats: 0.75 }, { label: '1/4', beats: 1 },
  { label: '1/2T', beats: 4 / 3 }, { label: '1/4D', beats: 1.5 }, { label: '1/2', beats: 2 }, { label: '1/2D', beats: 3 }, { label: '1/1', beats: 4 },
];
export const DEFAULT_NOTE = NOTES.findIndex((n) => n.label === '1/8');

// Attack is much shorter than Release, so it gets finer note values (1/256 ... 1/8).
export const ATTACK_NOTES = [
  { label: '1/256', beats: 1 / 64 }, { label: '1/128T', beats: 1 / 48 }, { label: '1/128', beats: 1 / 32 }, { label: '1/64T', beats: 1 / 24 },
  { label: '1/64', beats: 1 / 16 }, { label: '1/32T', beats: 1 / 12 }, { label: '1/32', beats: 1 / 8 }, { label: '1/16T', beats: 1 / 6 },
  { label: '1/16', beats: 1 / 4 }, { label: '1/8T', beats: 1 / 3 }, { label: '1/8', beats: 1 / 2 },
];
export const DEFAULT_ATTACK_NOTE = ATTACK_NOTES.findIndex((n) => n.label === '1/128');

// Length of a note value in milliseconds at `bpm`, limited to what the knob allows (Release 0.1-2500 ms, Attack 0.1-250 ms).
export const noteToMs = (index, bpm, list = NOTES, maxMs = 2500) => Math.min(maxMs, Math.max(0.1, list[Math.max(0, Math.min(list.length - 1, Math.round(index)))].beats * 60000 / bpm));
