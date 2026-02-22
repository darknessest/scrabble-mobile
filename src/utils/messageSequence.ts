export const MAX_SEQUENCE = 0xFFFFFFFF;
const HALF_SEQUENCE_RANGE = 0x80000000;

export function normalizeSequence(value: number): number {
  return value >>> 0;
}

export function isValidSequence(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1
    && value <= MAX_SEQUENCE;
}

export function isDuplicateOrStaleSequence(candidate: number, lastAccepted: number): boolean {
  const normalizedCandidate = normalizeSequence(candidate);
  const normalizedLast = normalizeSequence(lastAccepted);
  const delta = (normalizedCandidate - normalizedLast) >>> 0;
  return delta === 0 || delta >= HALF_SEQUENCE_RANGE;
}

export function nextSequence(last: number | undefined): number {
  if (typeof last !== 'number' || !Number.isInteger(last)) return 1;
  const normalized = normalizeSequence(last);
  if (normalized >= MAX_SEQUENCE) return 1;
  return normalized + 1;
}
