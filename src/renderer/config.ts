// src/renderer/config.ts — renderer-side configuration.
//
// Secrets that the renderer is ALLOWED to hold are the Vapi PUBLIC (publishable)
// key and the proxy/ngrok base URL the inline custom-llm assistant points at.
// Everything else (Nebius/Anthropic/Vapi-private/Insforge admin keys) lives ONLY
// in MAIN — never read those here.
//
// Resolution order for each value:
//   1. window.RORO_CFG.<field>  (injected at runtime by MAIN/preload or a <script> tag;
//      the deployment-time placeholder this component consumes; legacy COMPANION_CFG still read)
//   2. import.meta.env.VITE_*         (Vite build-time env, optional)
//   3. a safe empty default
//
// When the public key is empty we DON'T crash the renderer — the avatar + event
// pipeline must still come alive for a model/keys-absent demo. Voice simply
// refuses to start a call and the UI shows why (see voice/wireEvents + ui).
//
// NOTE: ambient.d.ts (which declares window.RORO_CFG) is a global type-only
// declaration picked up automatically by tsc/Vite; it is NOT runtime-imported
// here (a .d.ts has no JS to import).

export interface RoroConfig {
  /** Vapi PUBLISHABLE key — safe to ship in the renderer. */
  vapiPublicKey: string;
  /**
   * Server-side Vapi assistant id. When non-empty, the renderer starts the call
   * with this id (the existing hosted Roro assistant) instead of the
   * inline custom-llm assistant — no local proxy needed.
   */
  vapiAssistantId: string;
  /**
   * Base URL of the OpenAI-compatible custom-llm SSE proxy (ngrok ROOT, no
   * trailing /chat/completions — Vapi appends the path itself).
   */
  customLlmUrl: string;
  /** Nebius model id forwarded in the POST body as `model`. */
  customLlmModel: string;
  /** STT provider/model for the user's mic audio. */
  transcriberModel: string;
  /** 11labs voiceId the character speaks with. */
  voiceId: string;
  /** Live2D model path under /live2d (public dir). Absent file -> placeholder. */
  modelUrl: string;
  /** Opt-in transparent frameless window mode for the floating character demo. */
  floatingWindow: boolean;
  /** Dev: mount the on-device voice path against a FAKE engine (no whisper/Silero/Kokoro, no mic) so the
   *  local mouth-not-brain wiring is runnable end-to-end. Default false → the Vapi facade is unchanged. */
  fakeVoice: boolean;
}

function viteEnv(_key: string): string | undefined {
  // Vite's import.meta.env is omitted here so the shared (commonjs) tsconfig type-checks;
  // inject runtime config via window.RORO_CFG instead (set in index.html / preload).
  return undefined;
}

/** Runtime config field, preferring window.RORO_CFG and falling back to the deprecated COMPANION_CFG. */
function cfgField(field: keyof RoroConfig): string | boolean | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.RORO_CFG?.[field] ?? window.COMPANION_CFG?.[field];
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
    vapiPublicKey: read('vapiPublicKey', 'VITE_VAPI_PUBLIC_KEY', ''),
    vapiAssistantId: read('vapiAssistantId', 'VITE_VAPI_ASSISTANT_ID', ''),
    // Proxy base; MAIN PATCHes the live ngrok URL onto the Vapi assistant each
    // launch, but the renderer-side inline assistant still needs a value.
    customLlmUrl: read('customLlmUrl', 'VITE_CUSTOM_LLM_URL', 'http://127.0.0.1:8787'),
    customLlmModel: read('customLlmModel', 'VITE_CUSTOM_LLM_MODEL', 'deepseek-ai/DeepSeek-V3.2'),
    transcriberModel: read('transcriberModel', 'VITE_TRANSCRIBER_MODEL', 'nova-2'),
    voiceId: read('voiceId', 'VITE_VAPI_VOICE_ID', 'burt'),
    modelUrl: read('modelUrl', 'VITE_LIVE2D_MODEL_URL', './live2d/Haru.model3.json'),
    floatingWindow: readBool('floatingWindow', 'VITE_RORO_FLOATING_WINDOW', false),
    fakeVoice: readBool('fakeVoice', 'VITE_RORO_FAKE_VOICE', false),
  };
}
