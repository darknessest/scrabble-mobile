import { describe, expect, it } from 'vitest';
import { reconcileOrder, shuffleCopy } from './rackOrder';

describe('rackOrder', () => {
  it('reconcileOrder preserves previous order for existing items', () => {
    const prev = ['b', 'a', 'c'];
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const next = reconcileOrder(prev, items, (x) => x.id);
    expect(next).toEqual(['b', 'a', 'c']);
  });

  it('reconcileOrder drops ids that are no longer present', () => {
    const prev = ['a', 'missing', 'b'];
    const items = [{ id: 'b' }, { id: 'a' }];
    const next = reconcileOrder(prev, items, (x) => x.id);
    expect(next).toEqual(['a', 'b']);
  });

  it('reconcileOrder appends newly seen ids at the end (in rack order)', () => {
    const prev = ['b'];
    const items = [{ id: 'b' }, { id: 'a' }, { id: 'c' }];
    const next = reconcileOrder(prev, items, (x) => x.id);
    expect(next).toEqual(['b', 'a', 'c']);
  });

  it('shuffleCopy is deterministic with injected rng and preserves elements', () => {
    const seq = [0.0, 0.0, 0.0]; // always pick j=0 for i=3,2,1
    let k = 0;
    const rng = () => seq[k++] ?? 0;
    const input = [1, 2, 3, 4];
    const out = shuffleCopy(input, rng);

    // Should not mutate input
    expect(input).toEqual([1, 2, 3, 4]);
    // Deterministic expected order for this rng sequence
    expect(out).toEqual([2, 3, 4, 1]);
    // Same multiset of elements
    expect([...out].sort()).toEqual([1, 2, 3, 4]);
  });
});



