import { describe, it, expect } from 'vitest';
import { escapeHtml } from './escapeHtml';

describe('escapeHtml', () => {
  it('escapes all HTML-significant characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('returns unchanged text when no escaping is required', () => {
    expect(escapeHtml('Scrabble WPA 123')).toBe('Scrabble WPA 123');
  });

  it('escapes script-like payloads so they render as text', () => {
    const input = `<img src=x onerror="alert('xss')">`;
    expect(escapeHtml(input)).toBe('&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;');
  });

  it('handles empty strings', () => {
    expect(escapeHtml('')).toBe('');
  });
});
