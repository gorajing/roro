// src/main/pointerOverlay.ts — the desktop-wide, click-through overlay roro points a paw through.
//
// The pet window stays small and interactive; pointing at an arbitrary desktop pixel needs a SEPARATE
// surface that spans the display and lets every click pass through to the app underneath. This is that
// surface: a frameless, transparent, always-on-top, focus-less BrowserWindow with OS-level click-through
// (setIgnoreMouseEvents forward:true) covering the primary display. It never captures input and only ever
// draws a transient ring + paw at a point pushed from MAIN — so it is driven entirely by executeJavaScript
// (no preload, no IPC channel, no second renderer entry). READ-screen + POINT only: point-don't-act holds.
//
// v0 covers the PRIMARY display only (roro's screen capture also grabs display 1); multi-display is a
// follow-up (union-bounds overlay + per-display bounds).

import { BrowserWindow, screen } from 'electron';
import { groundBoxToDesktopPoint, type DesktopPoint, type NormalizedBox } from '../shared/pointing';

let overlay: BrowserWindow | null = null;
let loaded = false;

// The overlay document: a transparent full-window canvas with one global, roroShowPoint(x, y, confidence),
// that draws roro's ring + paw at overlay-local (x,y) and fades it out. Low confidence → a wide "around
// here" halo (fail-loud: never a confident tight paw when the model is unsure).
const OVERLAY_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:transparent;}
  #layer{position:absolute;inset:0;pointer-events:none;}
  .roro-point{position:absolute;transform:translate(-50%,-50%);will-change:transform,opacity;}
  .roro-ring{position:absolute;transform:translate(-50%,-50%);border-radius:50%;
    box-shadow:0 0 0 2px rgba(120,175,255,0.95),0 0 18px 4px rgba(120,175,255,0.5);
    border:2px solid rgba(230,240,255,0.95);}
  .roro-ring.wide{border-style:dashed;border-color:rgba(230,240,255,0.7);
    box-shadow:0 0 0 2px rgba(120,175,255,0.5),0 0 24px 6px rgba(120,175,255,0.35);}
  .roro-paw{position:absolute;font-size:26px;line-height:1;transform:translate(-50%,-50%);
    filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5));}
  @keyframes roroPulse{0%{transform:translate(-50%,-50%) scale(0.4);opacity:0;}
    18%{transform:translate(-50%,-50%) scale(1.15);opacity:1;}
    30%{transform:translate(-50%,-50%) scale(1);opacity:1;}
    100%{transform:translate(-50%,-50%) scale(1);opacity:1;}}
  @keyframes roroFade{to{opacity:0;}}
</style></head><body><div id="layer"></div><script>
  window.__roroLastPoint = null;
  window.roroShowPoint = function(x, y, confidence){
    window.__roroLastPoint = { x: x, y: y, confidence: confidence };
    var layer = document.getElementById('layer');
    layer.replaceChildren();
    var conf = typeof confidence === 'number' ? confidence : 0.5;
    var wide = conf < 0.55;                          // uncertain → wide "around here" halo
    var r = wide ? 46 : 20;                          // ring radius (px)
    var ring = document.createElement('div');
    ring.className = 'roro-ring' + (wide ? ' wide' : '');
    ring.style.left = x + 'px'; ring.style.top = y + 'px';
    ring.style.width = (r*2) + 'px'; ring.style.height = (r*2) + 'px';
    ring.style.animation = 'roroPulse 700ms cubic-bezier(.2,.9,.2,1) both, roroFade 500ms ease 3200ms forwards';
    layer.appendChild(ring);
    var paw = document.createElement('div');
    paw.className = 'roro-paw';
    // the paw rests just up-left of the ring, "reaching" toward the target
    paw.style.left = (x - r - 10) + 'px'; paw.style.top = (y - r - 10) + 'px';
    paw.textContent = '\u{1F43E}';
    paw.style.animation = 'roroPulse 700ms cubic-bezier(.2,.9,.2,1) 60ms both, roroFade 500ms ease 3200ms forwards';
    layer.appendChild(paw);
    return { x: x, y: y, r: r, wide: wide };
  };
  window.roroClearPoint = function(){ document.getElementById('layer').replaceChildren(); window.__roroLastPoint=null; };
</script></body></html>`;

/** Lazily create the click-through overlay covering the primary display. Reused across points. */
export function ensurePointerOverlay(): BrowserWindow {
  if (overlay && !overlay.isDestroyed()) return overlay;
  const b = screen.getPrimaryDisplay().bounds; // DIP
  overlay = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    acceptFirstMouse: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setIgnoreMouseEvents(true, { forward: true }); // OS click-through: never blocks the app underneath
  // Re-assert full-display bounds AFTER raising the level: at normal level macOS pushes the window below
  // the menu bar (a ~30px Y shift); at screen-saver level it can cover the whole display incl. the menu bar.
  overlay.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
  overlay.showInactive(); // paint it on-screen without stealing focus from the app underneath
  loaded = false;
  overlay.webContents.once('did-finish-load', () => { loaded = true; });
  overlay.on('closed', () => { overlay = null; loaded = false; });
  void overlay.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(OVERLAY_HTML));
  return overlay;
}

/** Draw roro's ring + paw at a global DIP desktop point (confidence sizes the halo). Fades on its own. */
export async function showPointAt(point: DesktopPoint, confidence: number): Promise<void> {
  const win = ensurePointerOverlay();
  const b = win.getBounds();
  const lx = point.x - b.x; // overlay-local coords
  const ly = point.y - b.y;
  const conf = Number.isFinite(confidence) ? confidence : 0.5;
  const run = (): Promise<unknown> =>
    win.webContents
      .executeJavaScript(`window.roroShowPoint && window.roroShowPoint(${lx}, ${ly}, ${conf})`, true)
      .catch(() => undefined);
  if (loaded) {
    await run();
  } else {
    win.webContents.once('did-finish-load', () => { void run(); });
  }
}

/** Transform a normalized grounded box to a primary-display desktop point and draw the paw there. v0:
 *  primary display only (matches the single-display screen capture). */
export async function showPointForBox(box: NormalizedBox, confidence: number): Promise<void> {
  const point = groundBoxToDesktopPoint(box, screen.getPrimaryDisplay().bounds);
  await showPointAt(point, confidence);
}

/** Tear the overlay down (e.g. on quit). */
export function destroyPointerOverlay(): void {
  if (overlay && !overlay.isDestroyed()) overlay.destroy();
  overlay = null;
  loaded = false;
}
