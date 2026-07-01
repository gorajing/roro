import { describe, it, expect } from 'vitest';
import { parseGroundResponse } from './index';

// parseGroundResponse is the fail-safe core of the paw-on-the-pixel wedge: a bad parse must yield NO box
// (roro shows no paw) rather than a confident wrong point. These tests pin that contract.
describe('parseGroundResponse — phrase→box grounding parser', () => {
  it('parses a normalized 0-1 box into top-left + size', () => {
    const r = parseGroundResponse('{"found": true, "box": [0.2, 0.1, 0.6, 0.4], "confidence": 0.9}');
    expect(r).not.toBeNull();
    expect(r!.box.x).toBeCloseTo(0.2);
    expect(r!.box.y).toBeCloseTo(0.1);
    expect(r!.box.w).toBeCloseTo(0.4); // 0.6 - 0.2
    expect(r!.box.h).toBeCloseTo(0.3); // 0.4 - 0.1
    expect(r!.confidence).toBeCloseTo(0.9);
  });

  it('returns null when the model says found:false (fail-loud — no paw)', () => {
    expect(parseGroundResponse('{"found": false}')).toBeNull();
  });

  it('parses qwen2.5-VL native bbox_2d in 0-1000 scale', () => {
    const r = parseGroundResponse('{"bbox_2d": [200, 100, 600, 400]}');
    expect(r).not.toBeNull();
    expect(r!.box.x).toBeCloseTo(0.2);
    expect(r!.box.w).toBeCloseTo(0.4);
    expect(r!.confidence).toBeCloseTo(0.8); // unstated → confident (a returned box means it was located)
  });

  it('returns null for the qwen "not visible" sentinel {"bbox_2d": null}', () => {
    expect(parseGroundResponse('{"bbox_2d": null}')).toBeNull();
  });

  it('normalizes qwen pixel coords per-axis using the image dimensions (the real observed output)', () => {
    // The model boxed the whole ~1280x720 screen with slight overshoot; clamps to the full frame.
    const r = parseGroundResponse('```json\n{"bbox_2d": [0, 0, 1287, 728]}\n```', 1280, 720);
    expect(r).not.toBeNull();
    expect(r!.box.x).toBe(0);
    expect(r!.box.y).toBe(0);
    expect(r!.box.w).toBeCloseTo(1);
    expect(r!.box.h).toBeCloseTo(1);
  });

  it('grounds a small element from pixel coords + dims (per-axis normalization)', () => {
    const r = parseGroundResponse('{"bbox_2d": [960, 72, 1040, 108]}', 1280, 720);
    expect(r).not.toBeNull();
    expect(r!.box.x).toBeCloseTo(0.75); // 960/1280
    expect(r!.box.y).toBeCloseTo(0.1);  // 72/720
    expect(r!.box.w).toBeCloseTo(80 / 1280);
    expect(r!.box.h).toBeCloseTo(36 / 720);
  });

  it('strips a ```json fence before parsing', () => {
    const r = parseGroundResponse('```json\n{"found": true, "box": [0.1, 0.1, 0.2, 0.2]}\n```');
    expect(r).not.toBeNull();
    expect(r!.box.x).toBeCloseTo(0.1);
  });

  it('orders reversed corners (x1<x0) into a valid top-left box', () => {
    const r = parseGroundResponse('{"found": true, "box": [0.6, 0.4, 0.2, 0.1]}');
    expect(r).not.toBeNull();
    expect(r!.box.x).toBeCloseTo(0.2);
    expect(r!.box.y).toBeCloseTo(0.1);
    expect(r!.box.w).toBeCloseTo(0.4);
    expect(r!.box.h).toBeCloseTo(0.3);
  });

  it('clamps out-of-range coordinates and confidence into [0,1]', () => {
    const r = parseGroundResponse('{"found": true, "box": [-0.1, 0.5, 0.5, 1.2], "confidence": 5}');
    expect(r).not.toBeNull();
    expect(r!.box.x).toBe(0); // -0.1 clamped
    expect(r!.box.y + r!.box.h).toBeCloseTo(1); // 1.2 clamped to 1
    expect(r!.confidence).toBe(1);
  });

  it('returns null for a degenerate (zero-area) box', () => {
    expect(parseGroundResponse('{"found": true, "box": [0.3, 0.3, 0.3, 0.5]}')).toBeNull();
  });

  it('returns null for raw-pixel coords it cannot normalize (>1000) — fail safe', () => {
    expect(parseGroundResponse('{"found": true, "box": [200, 100, 1900, 1000]}')).toBeNull();
  });

  it('returns null for malformed / non-JSON / missing-box responses', () => {
    expect(parseGroundResponse('the save button is at the top right')).toBeNull();
    expect(parseGroundResponse('{"found": true}')).toBeNull(); // no box
    expect(parseGroundResponse('{"found": true, "box": [0.1, 0.2, 0.3]}')).toBeNull(); // 3 coords
    expect(parseGroundResponse('{"found": true, "box": "everywhere"}')).toBeNull();
    expect(parseGroundResponse('not json at all')).toBeNull();
  });
});
