import type { GameState } from '../core/types';
import type { SessionMeta } from '../types';

export function buildSyncStateForPeer(gameState: GameState, meta: SessionMeta): GameState {
  if (!meta.isHost || !meta.remotePlayerId) return gameState;

  const visibleRackPlayerId = meta.remotePlayerId;
  const sanitizedRacks: Record<string, GameState['racks'][string]> = {};

  for (const playerId of gameState.players) {
    const rack = gameState.racks[playerId] ?? [];
    sanitizedRacks[playerId] = playerId === visibleRackPlayerId ? [...rack] : [];
  }

  return {
    ...gameState,
    racks: sanitizedRacks
  };
}
