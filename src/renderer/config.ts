// src/renderer/config.ts — renderer-side configuration.
//
// The renderer holds ONLY non-secret presentation/feature values (the
// floating-window flag, the on-device voice dev flags). Every key
// (e.g. the Anthropic executor key) lives ONLY in MAIN — never read those here.
//
// Resolution order for each value:
//   1. window.RORO_CFG.<field>  (injected at runtime by MAIN/preload or a <script> tag;
//      the deployment-time placeholder this component consumes)
//   2. import.meta.env.VITE_*         (Vite build-time env, optional)
//   3. a safe empty default
//
// NOTE: ambient.d.ts (which declares window.RORO_CFG) is a global type-only
// declaration picked up automatically by tsc/Vite; it is NOT runtime-imported
// here (a .d.ts has no JS to import).

export interface RoroConfig {
  /** Opt-in transparent frameless window mode for the floating character demo. */
  floatingWindow: boolean;
  /** Dev: mount the on-device voice path against a FAKE engine (no whisper/Silero/Kokoro, no mic) so the
   *  local mouth-not-brain wiring is runnable end-to-end. Default false. */
  fakeVoice: boolean;
  /** Dev: mount the REAL VAD engine (Silero, on-device) — Phase 1 = the ear-perk + mic lifecycle (no STT/
   *  TTS yet). Takes precedence over fakeVoice. Default false. */
  vadVoice: boolean;
  /** Dev: mount the REAL VAD + on-device STT (Silero + whisper base.en) — Phase 2 = the ear-perk PLUS a
   *  committed transcript (partials → caption tell, final → turnRun). Implies vadVoice; takes precedence
   *  over it. Default false. */
  sttVoice: boolean;
  /** Dev: give the cat a MOUTH — on-device Kokoro TTS + lip-sync (Phase 3). The assistant's committed
   *  `message` is spoken on-device with a moving mouth. Mounts the real VAD engine too (ears), and composes
   *  with sttVoice for the full local voice loop. Default false. */
  ttsVoice: boolean;
  /** The initial voice-pack id (Phase 5 cosmetic; RORO_VOICE_PACK). Empty/unknown → the free default
   *  af_heart. Switchable at runtime via __roroVoice.setVoice. Only meaningful when ttsVoice is on. */
  voicePack: string;
  /** WS5 validation (M9): mount the cosmetics fake-door (captures willingness-to-pay intent, no payment).
   *  OFF by default — the founder enables it to run the demand experiment. RORO_WS5_STORE=1. */
  cosmeticsStore: boolean;
  /** Dev/security escape hatch: expose direct brain/vision/debug handles. Default false. */
  debugBridge: boolean;
  /** Test-only: expose the floating Ask lifecycle harness for the on-screen smoke. Default false. */
  floatingSmoke: boolean;
  /** Test-only: render the Memory panel against deterministic local facts for the keyboard/a11y smoke. */
  memoryPanelSmoke: boolean;
}

export function voiceSurfaceEnabled(config: Pick<RoroConfig, 'fakeVoice' | 'vadVoice' | 'sttVoice' | 'ttsVoice'>): boolean {
  return config.fakeVoice || config.vadVoice || config.sttVoice || config.ttsVoice;
}

function viteEnv(_key: string): string | undefined {
  // Vite's import.meta.env is omitted here so the shared (commonjs) tsconfig type-checks;
  // inject runtime config via window.RORO_CFG instead (set in index.html / preload).
  return undefined;
}

/** Runtime config field from window.RORO_CFG (the only runtime injection path). */
function cfgField(field: keyof RoroConfig): string | boolean | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.RORO_CFG?.[field];
}

function read(field: keyof RoroConfig, viteKey: string, fallback: string): string {
  const fromWindow = cfgField(field);
  return typeof fromWindow === 'string' ? fromWindow : viteEnv(viteKey) ?? fallback;
}

function readBool(field: keyof RoroConfig, viteKey: string, fallback: boolean): boolean {
  const fromWindow = cfgField(field);
  if (typeof fromWindow === 'boolean') return fromWindow;
  const raw = typeof fromWindow === 'string' ? fromWindow : viteEnv(viteKey);
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export function loadConfig(): RoroConfig {
  return {
    // Floating desktop-pet UI is the product default (MAIN sets window.RORO_CFG.floatingWindow from
    // FLOATING_WINDOW_FLAG, which is on unless RORO_FLOATING_WINDOW=0). This fallback only applies when
    // RORO_CFG is absent (bare-browser/Vite dev) — kept in sync with MAIN so both default to floating.
    floatingWindow: readBool('floatingWindow', 'VITE_RORO_FLOATING_WINDOW', true),
    fakeVoice: readBool('fakeVoice', 'VITE_RORO_FAKE_VOICE', false),
    vadVoice: readBool('vadVoice', 'VITE_RORO_VAD_VOICE', false),
    sttVoice: readBool('sttVoice', 'VITE_RORO_STT_VOICE', false),
    ttsVoice: readBool('ttsVoice', 'VITE_RORO_TTS_VOICE', false),
    voicePack: read('voicePack', 'VITE_RORO_VOICE_PACK', ''),
    cosmeticsStore: readBool('cosmeticsStore', 'VITE_RORO_WS5_STORE', false),
    debugBridge: readBool('debugBridge', 'VITE_RORO_DEBUG_BRIDGE', false),
    floatingSmoke: readBool('floatingSmoke', 'VITE_RORO_FLOATING_SMOKE', false),
    memoryPanelSmoke: readBool('memoryPanelSmoke', 'VITE_RORO_MEMORY_PANEL_SMOKE', false),
  };
}
