// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SessionMeta } from '../types';
import { TimerController } from './timerController';

function makeMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    mode: 'solo',
    language: 'en',
    isHost: true,
    localPlayerId: 'host',
    sessionId: 's1',
    timerEnabled: true,
    timerDurationSec: 60,
    turnDeadline: null,
    ...overrides
  };
}

describe('TimerController', () => {
  let timerDisplay: HTMLSpanElement;
  let timerController: TimerController;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    timerDisplay = document.createElement('span');
    timerController = new TimerController(timerDisplay);
  });

  afterEach(() => {
    timerController.stopTimerTicker();
    vi.useRealTimers();
  });

  it('hides timer when disabled', () => {
    const meta = makeMeta({ timerEnabled: false, turnDeadline: Date.now() + 30_000 });
    timerController.setMeta(meta);

    timerController.resetTurnTimer(() => false);

    expect(timerDisplay.style.display).toBe('none');
    expect(meta.turnDeadline).toBeNull();
  });

  it('formats countdown as m:ss', () => {
    const meta = makeMeta({ turnDeadline: Date.now() + 65_000 });
    timerController.setMeta(meta);

    timerController.startTimerTicker();

    expect(timerDisplay.style.display).toBe('');
    expect(timerDisplay.textContent).toBe('1:05');
    expect(timerDisplay.classList.contains('active')).toBe(true);
    expect(timerDisplay.classList.contains('danger')).toBe(false);
  });

  it('fires timeout callback when remaining time reaches zero', () => {
    const onTimeout = vi.fn();
    const meta = makeMeta({ turnDeadline: Date.now() + 1_000 });
    timerController.setMeta(meta);
    timerController.setOnTimeout(onTimeout);

    timerController.startTimerTicker();
    vi.advanceTimersByTime(1_500);

    expect(onTimeout).toHaveBeenCalled();
    expect(timerDisplay.classList.contains('danger')).toBe(true);
  });

  it('resetTurnTimer sets deadline from timerDurationSec when missing', () => {
    const meta = makeMeta({ timerDurationSec: 30, turnDeadline: null });
    timerController.setMeta(meta);

    timerController.resetTurnTimer(() => false);

    expect(meta.turnDeadline).toBe(Date.now() + 30_000);
  });

  it('stopTimerForGameOver clears deadline and hides timer', () => {
    const meta = makeMeta({ turnDeadline: Date.now() + 10_000 });
    timerController.setMeta(meta);
    timerController.startTimerTicker();

    timerController.stopTimerForGameOver();

    expect(meta.turnDeadline).toBeNull();
    expect(timerDisplay.style.display).toBe('none');
  });
});
