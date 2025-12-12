import { describe, it, expect } from 'vitest';
import { buildPremiumMap } from './boardLayout';

describe('buildPremiumMap', () => {
  const map = buildPremiumMap();

  it('marks center as CENTER', () => {
    expect(map.get('7,7')).toBe('CENTER');
  });

  it('marks Triple Word (TW) correctly', () => {
    // Corners
    expect(map.get('0,0')).toBe('TW');
    expect(map.get('0,14')).toBe('TW');
    expect(map.get('14,0')).toBe('TW');
    expect(map.get('14,14')).toBe('TW');
    
    // Middle edges
    expect(map.get('0,7')).toBe('TW');
    expect(map.get('7,0')).toBe('TW');
  });

  it('marks Double Word (DW) correctly', () => {
    expect(map.get('1,1')).toBe('DW');
    expect(map.get('2,2')).toBe('DW');
    expect(map.get('3,3')).toBe('DW');
    expect(map.get('4,4')).toBe('DW');
  });

  it('marks Triple Letter (TL) correctly', () => {
    expect(map.get('1,5')).toBe('TL');
    expect(map.get('5,1')).toBe('TL');
    expect(map.get('5,5')).toBe('TL');
  });

  it('marks Double Letter (DL) correctly', () => {
    expect(map.get('0,3')).toBe('DL');
    expect(map.get('3,0')).toBe('DL');
    expect(map.get('6,2')).toBe('DL'); // Letter beside center star
    expect(map.get('8,2')).toBe('DL');
  });
});

