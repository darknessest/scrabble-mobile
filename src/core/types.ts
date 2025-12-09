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
  sessionId: string;
}

export interface MoveResult {
  success: boolean;
  message?: string;
  scoreDelta?: number;
}

