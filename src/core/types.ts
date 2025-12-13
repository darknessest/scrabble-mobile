export type Language = 'en' | 'ru';

export type Premium =
  | 'TW'
  | 'DW'
  | 'TL'
  | 'DL'
  | 'CENTER';

export interface Tile {
  id: string;
  letter: string;
  value: number;
  blank?: boolean;
}

export interface Placement {
  x: number;
  y: number;
  tile: Tile;
}

export interface BoardCell {
  tile: Tile | null;
}

export interface GameState {
  board: BoardCell[][];
  bag: Tile[];
  racks: Record<string, Tile[]>;
  scores: Record<string, number>;
  currentPlayer: string;
  players: string[];
  language: Language;
  moveNumber: number;
  history: GameHistoryEntry[];
  sessionId: string;
}

export type GameEndReason = 'four_passes' | 'no_moves_bag_empty';

export interface GameEndedInfo {
  reason: GameEndReason;
  finalScores: Record<string, number>;
}

export type GameHistoryEntry =
  | {
    type: 'MOVE';
    moveNumber: number;
    playerId: string;
    scoreDelta: number;
    words: string[];
    placedTiles: number;
    timestamp: number;
  }
  | {
    type: 'PASS';
    moveNumber: number;
    playerId: string;
    timestamp: number;
  }
  | {
    type: 'EXCHANGE';
    moveNumber: number;
    playerId: string;
    exchangedTiles: number;
    timestamp: number;
  };

export interface MoveResult {
  success: boolean;
  message?: string;
  scoreDelta?: number;
  words?: string[];
  gameEnded?: GameEndedInfo;
}

