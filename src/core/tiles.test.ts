import { describe, it, expect } from 'vitest';
import { buildBag } from './tiles';

describe('buildBag', () => {
    it('builds English bag with correct count and values', () => {
        const bag = buildBag('en');

        // Check total count (100 tiles for EN standard)
        expect(bag).toHaveLength(100);

        // Check specific letter counts
        const count = (char: string) => bag.filter(t => t.letter === char).length;

        expect(count('A')).toBe(9);
        expect(count('Z')).toBe(1);
        expect(count(' ')).toBe(2); // Blanks

        // Check values
        const valueOf = (char: string) => bag.find(t => t.letter === char)?.value;
        expect(valueOf('A')).toBe(1);
        expect(valueOf('Z')).toBe(10);
        expect(valueOf(' ')).toBe(0);
    });

    it('builds Russian bag with correct count and values', () => {
        const bag = buildBag('ru');

        // Check total count (104 tiles for RU standard)
        expect(bag).toHaveLength(104);

        // Check specific letter counts
        const count = (char: string) => bag.filter(t => t.letter === char).length;

        expect(count('О')).toBe(10);
        expect(count('Ф')).toBe(1);

        // Check values
        const valueOf = (char: string) => bag.find(t => t.letter === char)?.value;
        expect(valueOf('О')).toBe(1);
        expect(valueOf('Ф')).toBe(10);
    });

    it('assigns unique IDs to tiles', () => {
        const bag = buildBag('en');
        const ids = new Set(bag.map(t => t.id));
        expect(ids.size).toBe(bag.length);
    });
});


