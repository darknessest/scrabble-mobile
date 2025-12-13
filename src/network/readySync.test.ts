import { describe, expect, it } from 'vitest';
import { allPlayersReady, maybeComputeGameStartAt } from './readySync';

describe('readySync', () => {
  it('allPlayersReady returns false if any player missing or false', () => {
    expect(allPlayersReady(['a', 'b'], { a: true })).toBe(false);
    expect(allPlayersReady(['a', 'b'], { a: true, b: false })).toBe(false);
    expect(allPlayersReady(['a', 'b'], undefined)).toBe(false);
  });

  it('allPlayersReady returns true only when all players are true', () => {
    expect(allPlayersReady(['a', 'b'], { a: true, b: true })).toBe(true);
  });

  it('maybeComputeGameStartAt returns null until all players ready', () => {
    const now = 1000;
    expect(
      maybeComputeGameStartAt({
        currentStartAt: null,
        players: ['a', 'b'],
        readyState: { a: true, b: false },
        now,
        graceMs: 3000
      })
    ).toBe(null);
  });

  it('maybeComputeGameStartAt schedules now+grace once all players ready', () => {
    const now = 1000;
    expect(
      maybeComputeGameStartAt({
        currentStartAt: null,
        players: ['a', 'b'],
        readyState: { a: true, b: true },
        now,
        graceMs: 3000
      })
    ).toBe(4000);
  });

  it('maybeComputeGameStartAt is idempotent once scheduled', () => {
    expect(
      maybeComputeGameStartAt({
        currentStartAt: 9999,
        players: ['a', 'b'],
        readyState: { a: false, b: false },
        now: 1,
        graceMs: 3000
      })
    ).toBe(9999);
  });
});


