import { describe, expect, it } from 'vitest';
import { applyActionButtonsStateToDom } from './actionButtonsState';
import type { GameState } from '../core/types';

function makeButtons() {
  return {
    confirmMoveBtn: { disabled: false },
    passBtn: { disabled: false },
    exchangeBtn: { disabled: false },
    clearPlacementsBtn: { disabled: false },
    mixRackBtn: { disabled: false }
  };
}

function makeState(currentPlayer: string): GameState {
  return {
    board: Array.from({ length: 15 }, () => Array.from({ length: 15 }, () => ({ tile: null }))),
    bag: [],
    racks: {},
    scores: {},
    currentPlayer,
    players: [currentPlayer],
    language: 'en',
    moveNumber: 0,
    history: [],
    sessionId: 'test'
  };
}

describe('applyActionButtonsStateToDom', () => {
  it('enables move buttons when it is my turn and not locked', () => {
    const buttons = makeButtons();
    const state = makeState('me');

    applyActionButtonsStateToDom(buttons, {
      state,
      localPlayerId: 'me',
      locked: false,
      isOver: false,
      placementsCount: 0
    });

    expect(buttons.confirmMoveBtn.disabled).toBe(false);
    expect(buttons.passBtn.disabled).toBe(false);
    expect(buttons.exchangeBtn.disabled).toBe(false);
  });

  it('disables move buttons when it is not my turn', () => {
    const buttons = makeButtons();
    const state = makeState('other');

    applyActionButtonsStateToDom(buttons, {
      state,
      localPlayerId: 'me',
      locked: false,
      isOver: false,
      placementsCount: 0
    });

    expect(buttons.confirmMoveBtn.disabled).toBe(true);
    expect(buttons.passBtn.disabled).toBe(true);
    expect(buttons.exchangeBtn.disabled).toBe(true);
  });

  it('keeps Clear placements available based on placementsCount (even if not my turn), but disables it when locked', () => {
    const buttons = makeButtons();
    const state = makeState('other');

    applyActionButtonsStateToDom(buttons, {
      state,
      localPlayerId: 'me',
      locked: false,
      isOver: false,
      placementsCount: 2
    });
    expect(buttons.clearPlacementsBtn.disabled).toBe(false);

    applyActionButtonsStateToDom(buttons, {
      state,
      localPlayerId: 'me',
      locked: true,
      isOver: false,
      placementsCount: 2
    });
    expect(buttons.clearPlacementsBtn.disabled).toBe(true);
  });
});


