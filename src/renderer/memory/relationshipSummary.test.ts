import { describe, it, expect } from 'vitest';
import { formatRelationshipCount } from './relationshipSummary';

describe('formatRelationshipCount', () => {
  it('says nothing when Roro knows nothing yet', () => {
    expect(formatRelationshipCount(0)).toBe('');
    expect(formatRelationshipCount(-1)).toBe('');
  });

  it('uses the singular for one fact', () => {
    expect(formatRelationshipCount(1)).toBe('Roro remembers 1 thing about you.');
  });

  it('uses the plural for many facts', () => {
    expect(formatRelationshipCount(5)).toBe('Roro remembers 5 things about you.');
  });

  it('makes no claim about confirmation (just a count)', () => {
    expect(formatRelationshipCount(3)).not.toContain('confirm');
    expect(formatRelationshipCount(3)).not.toContain('corroborat');
  });
});
