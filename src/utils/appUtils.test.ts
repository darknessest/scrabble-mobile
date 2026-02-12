import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce, looksLikeEncodedSdp, formatCountdownMs, formatGameOverReason } from './appUtils';

describe('looksLikeEncodedSdp', () => {
  it('returns true for valid encoded SDP', () => {
    const sdp = { type: 'offer', sdp: 'v=0\r\no=...' };
    const encoded = btoa(JSON.stringify(sdp));
    expect(looksLikeEncodedSdp(encoded)).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(looksLikeEncodedSdp('')).toBe(false);
  });

  it('returns false for non-base64 text', () => {
    expect(looksLikeEncodedSdp('hello world')).toBe(false);
  });

  it('returns false for valid base64 that is not SDP', () => {
    const encoded = btoa(JSON.stringify({ foo: 'bar' }));
    expect(looksLikeEncodedSdp(encoded)).toBe(false);
  });

  it('returns false for base64 of non-object', () => {
    const encoded = btoa('"just a string"');
    expect(looksLikeEncodedSdp(encoded)).toBe(false);
  });

  it('returns false for SDP with non-string type', () => {
    const encoded = btoa(JSON.stringify({ type: 123, sdp: 'v=0' }));
    expect(looksLikeEncodedSdp(encoded)).toBe(false);
  });
});

describe('formatCountdownMs', () => {
  it('formats zero as 0s', () => {
    expect(formatCountdownMs(0)).toBe('0s');
  });

  it('rounds up partial seconds', () => {
    expect(formatCountdownMs(500)).toBe('1s');
    expect(formatCountdownMs(1)).toBe('1s');
  });

  it('formats full seconds', () => {
    expect(formatCountdownMs(3000)).toBe('3s');
  });

  it('handles negative values gracefully', () => {
    expect(formatCountdownMs(-1000)).toBe('0s');
  });
});

describe('formatGameOverReason', () => {
  it('formats four_passes reason', () => {
    expect(formatGameOverReason('four_passes')).toBe('Both players passed twice in a row.');
  });

  it('formats no_moves_bag_empty reason', () => {
    expect(formatGameOverReason('no_moves_bag_empty')).toBe(
      'No tiles left in the bag and no valid moves available.'
    );
  });
});

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // debounce uses window.setTimeout/clearTimeout — proxy to globalThis (now faked)
    (globalThis as Record<string, unknown>).window = new Proxy(globalThis, {
      get(target, prop) {
        return Reflect.get(target, prop);
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).window;
  });

  it('delays execution by the specified time', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('resets the timer on subsequent calls', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced();
    vi.advanceTimersByTime(50);
    debounced();
    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('passes arguments to the original function', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced('a', 'b');
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledWith('a', 'b');
  });
});
