export function resolveMinWordLength(minLength?: number | string): number {
  return Math.max(1, Math.floor(Number(minLength) || 2));
}
