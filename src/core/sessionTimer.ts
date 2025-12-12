export type SessionMode = 'solo' | 'host' | 'client';

export interface SessionTimerMeta {
  mode: SessionMode;
  remotePlayerId?: string;
  timerEnabled?: boolean;
  timerDurationSec?: number;
  turnDeadline?: number | null;
}

/**
 * Determines whether the very first turn timer is allowed to start.
 *
 * - In P2P host mode we wait until the data channel is open (both users connected),
 *   but only for the initial start (when there is no existing deadline yet).
 * - In solo mode we can start immediately.
 * - In client mode we never authoritatively start the timer; we wait for host sync.
 */
export function canStartInitialTurnTimer(meta: SessionTimerMeta | null, connectionReady: boolean): boolean {
  if (!meta) return false;
  if (!meta.timerEnabled || !meta.timerDurationSec) return false;

  if (meta.mode === 'solo') return true;
  if (meta.mode === 'client') return false;

  // Host: if this is a P2P session (has a remote player) and we have no deadline yet,
  // wait for the data channel to become ready.
  if (meta.mode === 'host' && meta.remotePlayerId && !meta.turnDeadline) {
    return connectionReady;
  }

  // Non-P2P host (or already started): OK.
  return true;
}


