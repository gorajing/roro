// src/shared/pointing.ts — the coordinate-transform core of the paw-on-the-pixel wedge.
//
// The vision model grounds a phrase to a box that is NORMALIZED (0-1) relative to a full-display
// screenshot (src/vision/index.ts captures a whole display, then downscales it — the box is a fraction of
// the image either way). Mapping that back to a desktop position is therefore a DIRECT scale into the
// display's DIP bounds: the capture downscale ratio and the DPI scaleFactor both cancel out, because a
// normalized fraction of the image is the same fraction of the display in any unit. (Contrast the pixel-
// coordinate approach, which must invert downscale + scaleFactor + origin by hand — the classic bug.)

/** A box normalized to [0,1] of the captured display (top-left x/y + size). */
export interface NormalizedBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A display rectangle in Electron's logical (DIP) space — i.e. an Electron `Display.bounds`. */
export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A point in global DIP desktop coordinates — the same space `screen.getCursorScreenPoint()` speaks. */
export interface DesktopPoint {
  x: number;
  y: number;
}

/** Centre of a normalized box mapped to a global DIP desktop point on the given display. DPI-agnostic. */
export function groundBoxToDesktopPoint(box: NormalizedBox, display: DisplayBounds): DesktopPoint {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return {
    x: Math.round(display.x + cx * display.width),
    y: Math.round(display.y + cy * display.height),
  };
}
