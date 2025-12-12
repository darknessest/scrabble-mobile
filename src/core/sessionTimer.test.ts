import { describe, expect, it } from 'vitest';
import { canStartInitialTurnTimer, type SessionTimerMeta } from './sessionTimer';

describe('canStartInitialTurnTimer', () => {
  it('returns false when meta is null', () => {
    expect(canStartInitialTurnTimer(null, true)).toBe(false);
  });

  it('returns false when timer is disabled or duration missing', () => {
    expect(canStartInitialTurnTimer({ mode: 'solo', timerEnabled: false, timerDurationSec: 300 }, true)).toBe(false);
    expect(canStartInitialTurnTimer({ mode: 'solo', timerEnabled: true, timerDurationSec: 0 }, true)).toBe(false);
    expect(canStartInitialTurnTimer({ mode: 'solo', timerEnabled: true }, true)).toBe(false);
  });

  it('starts immediately in solo mode when enabled', () => {
    expect(
      canStartInitialTurnTimer({ mode: 'solo', timerEnabled: true, timerDurationSec: 300, turnDeadline: null }, false)
    ).toBe(true);
  });

  it('never starts on the client (host is authoritative)', () => {
    expect(
      canStartInitialTurnTimer({ mode: 'client', timerEnabled: true, timerDurationSec: 300, turnDeadline: null }, true)
    ).toBe(false);
  });

  it('in P2P host mode, blocks initial start until the data channel is open', () => {
    const meta: SessionTimerMeta = {
      mode: 'host',
      remotePlayerId: 'client',
      timerEnabled: true,
      timerDurationSec: 300,
      turnDeadline: null
    };

    expect(canStartInitialTurnTimer(meta, false)).toBe(false);
    expect(canStartInitialTurnTimer(meta, true)).toBe(true);
  });

  it('in host mode, does not require connection once a deadline exists (subsequent resets)', () => {
    const meta: SessionTimerMeta = {
      mode: 'host',
      remotePlayerId: 'client',
      timerEnabled: true,
      timerDurationSec: 300,
      turnDeadline: Date.now() + 10_000
    };

    expect(canStartInitialTurnTimer(meta, false)).toBe(true);
  });

  it('in host mode without remote player, allows starting immediately', () => {
    const meta: SessionTimerMeta = {
      mode: 'host',
      timerEnabled: true,
      timerDurationSec: 300,
      turnDeadline: null
    };

    expect(canStartInitialTurnTimer(meta, false)).toBe(true);
  });
});


