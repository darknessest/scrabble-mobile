export function allPlayersReady(
  players: string[],
  readyState: Record<string, boolean> | undefined
): boolean {
  if (!readyState) return false;
  return players.every((id) => readyState[id] === true);
}

export function maybeComputeGameStartAt(opts: {
  currentStartAt: number | null;
  players: string[];
  readyState: Record<string, boolean> | undefined;
  now: number;
  graceMs: number;
}): number | null {
  if (opts.currentStartAt != null) return opts.currentStartAt;
  if (!allPlayersReady(opts.players, opts.readyState)) return null;
  return opts.now + opts.graceMs;
}


