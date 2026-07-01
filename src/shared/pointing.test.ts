import { describe, it, expect } from 'vitest';
import { groundBoxToDesktopPoint } from './pointing';

// The transform is the correctness core: get it wrong and every paw lands in the wrong place. These pin
// that a normalized box maps to the centre of the box in global DIP coords, independent of DPI.
describe('groundBoxToDesktopPoint — normalized box → global DIP point', () => {
  it('maps a centered box to the display centre (primary display at origin)', () => {
    const p = groundBoxToDesktopPoint({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, { x: 0, y: 0, width: 1000, height: 800 });
    expect(p).toEqual({ x: 500, y: 400 });
  });

  it('is DPI-agnostic — bounds are already DIP, so a retina 2x display just uses its DIP bounds', () => {
    // A 2880x1800 retina panel is 1440x900 in DIP. A box centred at 0.25,0.25 → 360,225 DIP.
    const p = groundBoxToDesktopPoint({ x: 0.2, y: 0.2, w: 0.1, h: 0.1 }, { x: 0, y: 0, width: 1440, height: 900 });
    expect(p).toEqual({ x: 360, y: 225 });
  });

  it('applies the display origin offset (a secondary monitor to the right)', () => {
    const p = groundBoxToDesktopPoint({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, { x: 1512, y: 0, width: 1920, height: 1080 });
    expect(p).toEqual({ x: 1512 + 960, y: 540 });
  });

  it('handles a negative-origin display (a monitor to the left of primary)', () => {
    const p = groundBoxToDesktopPoint({ x: 0.0, y: 0.0, w: 0.2, h: 0.2 }, { x: -1440, y: 0, width: 1440, height: 900 });
    // centre of box = (0.1, 0.1) → x = -1440 + 0.1*1440 = -1296, y = 0 + 0.1*900 = 90
    expect(p).toEqual({ x: -1296, y: 90 });
  });

  it('lands on the box centre for a tight top-right box', () => {
    const p = groundBoxToDesktopPoint({ x: 0.9, y: 0.02, w: 0.06, h: 0.04 }, { x: 0, y: 0, width: 2000, height: 1200 });
    expect(p).toEqual({ x: Math.round(0.93 * 2000), y: Math.round(0.04 * 1200) });
  });
});
