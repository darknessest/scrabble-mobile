import type { GameState } from '../core/types';

export type ButtonLike = { disabled: boolean };

export interface ActionButtons {
  confirmMoveBtn: ButtonLike;
  passBtn: ButtonLike;
  exchangeBtn: ButtonLike;
  clearPlacementsBtn: ButtonLike;
  mixRackBtn: ButtonLike;
}

export interface ActionButtonsStateInput {
  state: GameState | null;
  localPlayerId: string | null;
  locked: boolean;
  isOver: boolean;
  placementsCount: number;
}

/**
 * Centralized action-button enable/disable logic.
 * This is intentionally UI-focused (DOM buttons in/out) so we can cover it with jsdom tests.
 */
export function applyActionButtonsStateToDom(buttons: ActionButtons, input: ActionButtonsStateInput) {
  const isMyTurn = Boolean(input.state && input.localPlayerId && input.state.currentPlayer === input.localPlayerId);
  const canAct = !input.locked && !input.isOver && isMyTurn;

  buttons.confirmMoveBtn.disabled = !canAct;
  buttons.passBtn.disabled = !canAct;
  buttons.exchangeBtn.disabled = !canAct;

  // UX niceties
  // Clearing pending placements is always safe: it only affects local UI state.
  // Keep it available even if turn state changes (e.g. sync/reconnect) so users
  // can always "recall" temporarily placed tiles back to their rack.
  buttons.clearPlacementsBtn.disabled = input.locked || input.placementsCount === 0;
  buttons.mixRackBtn.disabled = input.locked || input.isOver;
}


