import type { GameState } from '../core/types';
import type { SessionMeta } from '../types';

type NormalizedBoard = Array<Array<{ id: string; letter: string; value: number; blank?: boolean } | null>>;

type NormalizedHistoryEntry =
  | {
    type: 'MOVE';
    moveNumber: number;
    playerId: string;
    scoreDelta: number;
    words: string[];
    placedTiles: number;
  }
  | {
    type: 'PASS';
    moveNumber: number;
    playerId: string;
  }
  | {
    type: 'EXCHANGE';
    moveNumber: number;
    playerId: string;
    exchangedTiles: number;
  };

type NormalizedState = {
  board: NormalizedBoard;
  bag: Array<{ id: string; letter: string; value: number; blank?: boolean }>;
  racks: Record<string, Array<{ id: string; letter: string; value: number; blank?: boolean }>>;
  scores: Record<string, number>;
  currentPlayer: string;
  players: string[];
  language: GameState['language'];
  moveNumber: number;
  lastMove: {
    moveNumber: number;
    playerId: string;
    placed: { x: number; y: number }[];
  } | null;
  history: NormalizedHistoryEntry[];
  sessionId: string;
};

function normalizeTile(tile: { id: string; letter: string; value: number; blank?: boolean } | null | undefined) {
  if (!tile) return null;
  return {
    id: tile.id,
    letter: tile.letter,
    value: tile.value,
    blank: tile.blank
  };
}

function normalizeBoard(gameState: GameState): NormalizedBoard {
  return gameState.board.map((row) =>
    row.map((cell) => {
      if (!cell.tile) return null;
      return normalizeTile(cell.tile);
    })
  );
}

function normalizeHistory(history: GameState['history']): NormalizedHistoryEntry[] {
  return history.map((entry) => {
    if (entry.type === 'MOVE') {
      return {
        type: 'MOVE',
        moveNumber: entry.moveNumber,
        playerId: entry.playerId,
        scoreDelta: entry.scoreDelta,
        words: [...entry.words],
        placedTiles: entry.placedTiles
      };
    }

    if (entry.type === 'PASS') {
      return {
        type: 'PASS',
        moveNumber: entry.moveNumber,
        playerId: entry.playerId
      };
    }

    return {
      type: 'EXCHANGE',
      moveNumber: entry.moveNumber,
      playerId: entry.playerId,
      exchangedTiles: entry.exchangedTiles
    };
  });
}

function normalizeState(gameState: GameState): NormalizedState {
  const orderedPlayers = [...gameState.players];
  const racks: Record<string, Array<{ id: string; letter: string; value: number; blank?: boolean }>> = {};
  const scores: Record<string, number> = {};

  for (const playerId of orderedPlayers) {
    racks[playerId] = (gameState.racks[playerId] ?? []).map((tile) => normalizeTile(tile) as {
      id: string;
      letter: string;
      value: number;
      blank?: boolean;
    });
    scores[playerId] = gameState.scores[playerId];
  }

  return {
    board: normalizeBoard(gameState),
    bag: gameState.bag.map((tile) => normalizeTile(tile) as {
      id: string;
      letter: string;
      value: number;
      blank?: boolean;
    }),
    racks,
    scores,
    currentPlayer: gameState.currentPlayer,
    players: orderedPlayers,
    language: gameState.language,
    moveNumber: gameState.moveNumber,
    lastMove: gameState.lastMove
      ? {
        moveNumber: gameState.lastMove.moveNumber,
        playerId: gameState.lastMove.playerId,
        placed: [...gameState.lastMove.placed]
      }
      : null,
    history: normalizeHistory(gameState.history),
    sessionId: gameState.sessionId
  };
}

function djb2(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) + value.charCodeAt(index);
    hash >>>= 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function computeStateHash(gameState: GameState): string {
  return djb2(JSON.stringify(normalizeState(gameState)));
}

export function verifyStateHash(gameState: GameState, stateHash?: string | null): boolean {
  if (!stateHash) {
    return false;
  }

  return computeStateHash(gameState) === stateHash;
}

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
