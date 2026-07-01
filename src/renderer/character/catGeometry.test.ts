import { describe, expect, it } from 'vitest';
import {
  catHeadBoundsForAction,
  SLEEPING_BODY_BOUNDS,
  SLEEPING_HEAD_BOUNDS,
} from './catGeometry';

describe('cat geometry', () => {
  it('keeps the sleeping head connected to the curled body', () => {
    const head = catHeadBoundsForAction('sleeping');

    expect(head.bottom).toBeGreaterThanOrEqual(SLEEPING_BODY_BOUNDS.top);
    expect(head.right).toBeGreaterThan(SLEEPING_BODY_BOUNDS.left);
    expect(head.left).toBeLessThan(SLEEPING_BODY_BOUNDS.right);
  });

  it('keeps the sleeping pose close to Roro sitting geometry', () => {
    const sittingHead = catHeadBoundsForAction('sitting');

    expect(SLEEPING_HEAD_BOUNDS.top).toBe(sittingHead.top);
    expect(SLEEPING_BODY_BOUNDS.bottom).toBe(15);
    expect(SLEEPING_HEAD_BOUNDS.left).toBe(sittingHead.left);
  });
});
