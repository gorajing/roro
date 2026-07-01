import OpenAI from 'openai';

import type { Command, Decision, DecideInput } from '../shared/brain';
import { buildFactPrompt, parseFactResponse, isPlausiblePreference, FACT_SYSTEM_PROMPT, type FactExtractInput, type FactCandidate } from './extractFact';
import { clarifyForReferentlessRequest } from './clarifyGate';
import { captureForLocateRequest } from './locateGate';
import { buildDecisionPrompt } from './decisionPrompt';
import { ollamaChat, ollamaEmbed, ollamaTags, hasModel, resolveOllamaEmbedDim, assertEmbedDimMatch } from './ollama';

declare const process: { env: Record<string, string | undefined> };

export type { Command, Decision, DecideInput } from '../shared/brain';
export type { FactExtractInput, FactCandidate } from './extractFact';

export interface DecideOptions {
  onReasoning?: (delta: string) => void;
  onContent?: (delta: string) => void;
}

export interface ScreenInput {
  b64: string;
  mime: string;
  /** Pixel dims of the image — lets groundTarget normalize a VL pixel-coordinate box back to [0,1]. */
  width?: number;
  height?: number;
}

/** A grounded target box, NORMALIZED to [0,1] (top-left x/y + size) relative to the captured image. */
export interface GroundBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GroundResult {
  box: GroundBox;
  /** the model's self-reported confidence in [0,1] (0.5 when unstated) — used to size the point halo. */
  confidence: number;
}

export interface ModelIds {
  reason: string;
  vision: string;
  embed: string;
}

export interface PreflightResult {
  required: ModelIds;
  found: string[];
  missing: string[];
}

type JsonRecord = Record<string, unknown>;

type ChatDeltaWithReasoning = {
  content?: string | null;
  reasoning_content?: string | null;
};

const NEBIUS_BASE_URL = 'https://api.tokenfactory.nebius.com/v1/';

// Roro is LOCAL-FIRST by default: the brain runs on the local Ollama daemon. BRAIN_PROVIDER=nebius
// flips every brain call back to the (retained) Nebius cloud path — an explicit escape hatch, not a
// silent fallback. The embedding dimension is provider-specific (Nebius Qwen=1536, local nomic=768
// or OLLAMA_EMBED_DIM when overriding OLLAMA_EMBED_MODEL); it is stamped on every memory row
// (embed_model/embed_dim) and the memory schema's vector(N) must match.
type BrainProvider = 'ollama' | 'nebius';
function brainProvider(): BrainProvider {
  return process.env.BRAIN_PROVIDER === 'nebius' ? 'nebius' : 'ollama';
}
function embeddingDim(): number {
  return brainProvider() === 'nebius' ? 1536 : resolveOllamaEmbedDim(process.env.OLLAMA_EMBED_DIM);
}

const NEBIUS_MODELS: ModelIds = {
  reason: 'deepseek-ai/DeepSeek-V3.2',
  vision: 'Qwen/Qwen2.5-VL-72B-Instruct',
  embed: 'Qwen/Qwen3-Embedding-8B',
};
const OLLAMA_MODELS: ModelIds = {
  reason: 'qwen2.5:3b',
  vision: 'qwen2.5vl:7b',
  embed: 'nomic-embed-text',
};

// Exhaustive Command map: the runtime list derives from its keys, so COMMANDS can never drift from
// the Command union — a missing key fails the build (Record<Command,…> demands all), an unknown key
// too. Adding a Command forces a deliberate entry here and in every Command switch.
const COMMAND_SET: Record<Command, true> = { run_agent: true, answer: true, capture_screen: true, clarify: true };
const COMMANDS = Object.keys(COMMAND_SET) as Command[];

const SYSTEM_PROMPT = `You are Roro, the brain of a desktop pixel-cat coding agent. The user talks to you by voice; an animated character speaks your words and a coding agent executes your commands.

You MUST respond with a SINGLE JSON object and nothing else:
{
  "narration": string,
  "command": "run_agent" | "answer" | "capture_screen" | "clarify",
  "args": object
}

COMMAND CONTRACT:
- "run_agent": dispatch a coding task to the executor. args = { "task": string, "cwd": string|null }.
  The executor is a coding agent with FULL read/write access to the project files — it can open,
  read, search, edit, and run code on its own. It does NOT need a screenshot to inspect code.
- "answer": just talk, no coding action. args = {}.
- "capture_screen": you need to SEE the user's screen to proceed. args = {}.
- "clarify": the request is ambiguous; ask one question. args = { "question": string }.

RULES:
- narration is spoken by the avatar, so keep it under 25 words and never include code, markdown, or JSON.
- Put all technical detail in args.task, not in narration.
- DEFAULT to "run_agent" for any coding, debugging, file, test, or build task — the executor reads and
  edits the project itself. Naming a file (e.g. "fix calc.py") is NOT a reason to capture the screen.
- Choose "capture_screen" when the request refers to something VISIBLE ON SCREEN that is not in the
  codebase — e.g. "what's this error on my screen", "look at what I'm seeing", a GUI/app/browser state —
  OR when asked to POINT AT / SHOW WHERE / LOCATE something on the screen (roro must SEE it to point).
- Choose "clarify" when the request has no concrete target yet — e.g. "fix it", "make it better",
  "update it", "change the color", or "do that thing we talked about" with no relevant memory/screen.
  Ask exactly one question that would make the task executable.
- If RELEVANT MEMORY is provided, use it for project paths, user preferences, and prior context.
- If CURRENT SCREEN is provided, use it as visual context.
- Output only the JSON object. Do not wrap it in markdown fences.

EXAMPLE:
USER SAID: "add a health check endpoint to my api"
{"narration":"On it. I will add the health check now.","command":"run_agent","args":{"task":"Add a GET /health endpoint returning {status:'ok'} with HTTP 200 to the existing API. Wire it into the main router and update or add the focused test.","cwd":null}}`;

let cachedClient: OpenAI | null = null;
let cachedApiKey: string | null = null;

export function getModelIds(): ModelIds {
  if (brainProvider() === 'nebius') {
    return {
      reason: process.env.NEBIUS_MODEL || NEBIUS_MODELS.reason,
      vision: process.env.NEBIUS_VISION_MODEL || NEBIUS_MODELS.vision,
      embed: process.env.NEBIUS_EMBED_MODEL || NEBIUS_MODELS.embed,
    };
  }
  return {
    reason: process.env.OLLAMA_MODEL || OLLAMA_MODELS.reason,
    vision: process.env.OLLAMA_VISION_MODEL || OLLAMA_MODELS.vision,
    embed: process.env.OLLAMA_EMBED_MODEL || OLLAMA_MODELS.embed,
  };
}

/**
 * User-visible label for the active brain, shown in the "…is planning the task…" beat. Provider-aware
 * so the local default never lies (it previously hardcoded "DeepSeek (Nebius)" even under Ollama).
 */
export function describeBrain(): string {
  const { reason } = getModelIds();
  return brainProvider() === 'nebius' ? `${reason} (Nebius)` : `${reason} (local Ollama)`;
}

export async function preflight(): Promise<PreflightResult> {
  const models = getModelIds();
  const essentialIds = [models.reason, models.embed];
  const checkedIds = [models.reason, models.vision, models.embed];

  if (brainProvider() === 'ollama') {
    const tags = await ollamaTags();
    const found = checkedIds.filter((id) => hasModel(tags, id));
    const missing = essentialIds.filter((id) => !hasModel(tags, id));
    if (missing.length > 0) {
      throw new Error(
        `Ollama models missing: ${missing.join(', ')}. Pull them with: ${missing.map((m) => `ollama pull ${m}`).join(' && ')}`,
      );
    }
    // The tag check confirms the embed model is pulled but not what dimension it emits. Probe it once
    // here and fail LOUD on a mismatch with the configured dim, so a non-768 OLLAMA_EMBED_MODEL override
    // is caught at startup (with the OLLAMA_EMBED_DIM remedy) rather than mid-turn or as a wrong vector.
    const [probe] = await ollamaEmbed(models.embed, 'preflight embedding dimension probe');
    assertEmbedDimMatch(models.embed, probe?.length ?? 0, embeddingDim());
    return { required: models, found, missing };
  }

  const list = await getNebiusClient().models.list();
  const availableIds = list.data.map((model) => model.id);
  const found = checkedIds.filter((id) => availableIds.indexOf(id) !== -1);
  const missing = essentialIds.filter((id) => availableIds.indexOf(id) === -1);
  const result = { required: models, found, missing };

  if (missing.length > 0) {
    throw new Error(
      `Nebius models missing: ${missing.join(', ')}. Available sample: ${availableIds.slice(0, 20).join(', ')}`,
    );
  }

  return result;
}

export async function decide(input: DecideInput, options: DecideOptions = {}): Promise<Decision> {
  const clarification = clarifyForReferentlessRequest(input);
  if (clarification) return clarification;

  // Paw-on-the-pixel: a clear on-screen "point at / where is X" intent deterministically routes to
  // capture_screen (the 3B is unreliable at inferring it). Stands down once the screen is captured.
  const locate = captureForLocateRequest(input);
  if (locate) return locate;

  const models = getModelIds();
  const userPrompt = buildDecisionPrompt(input);

  if (brainProvider() === 'ollama') {
    // Local path: Ollama /api/chat with format:'json'. qwen streams CONTENT only (no separate
    // reasoning channel), so onReasoning never fires — the avatar still animates off content deltas.
    const askOllama = (user: string, stream: boolean): Promise<string> =>
      ollamaChat({
        model: models.reason,
        system: SYSTEM_PROMPT,
        user,
        json: true,
        temperature: stream ? 0.3 : 0,
        stream,
        onContent: stream ? options.onContent : undefined,
      });

    const content = await askOllama(userPrompt, true);
    try {
      return parseDecision(content);
    } catch {
      // One-shot JSON repair: the 3B model occasionally emits an unparseable/invalid decision (M1 eval).
      // Re-ask ONCE for only the JSON object (non-streamed, deterministic) so a malformed reply self-
      // recovers instead of becoming run.failed. Still-bad after this one repair → throws → run.failed.
      const repaired = await askOllama(
        `${userPrompt}\n\nYour previous reply was NOT a valid decision. Reply with ONLY the JSON object ` +
          `{"narration": string, "command": "run_agent"|"answer"|"capture_screen"|"clarify", "args": object} ` +
          `and nothing else.`,
        false,
      );
      return parseDecision(repaired);
    }
  }

  const stream = await getNebiusClient().chat.completions.create({
    model: models.reason,
    stream: true,
    temperature: 0.3,
    max_tokens: 1200,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  });

  let content = '';

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta as ChatDeltaWithReasoning | undefined;

    if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
      options.onReasoning?.(delta.reasoning_content);
    }

    if (typeof delta?.content === 'string' && delta.content.length > 0) {
      content += delta.content;
      options.onContent?.(delta.content);
    }
  }

  return parseDecision(content);
}

/**
 * Thin 1-fact-per-turn extractor. Cheap, non-streaming, OFF the critical path.
 * Returns at most one durable fact, or null when there is nothing worth remembering.
 */
export async function extractFact(input: FactExtractInput): Promise<FactCandidate | null> {
  // Gate FIRST: the local model can't be trusted to output null, so only consult it when the transcript
  // reads like a stated preference. Most turns are one-off tasks/chitchat → return null without a model call
  // (also saves the call). This is what keeps the memory profile from filling with invented facts.
  if (!isPlausiblePreference(input)) return null;

  const models = getModelIds();
  const userPrompt = buildFactPrompt(input);

  if (brainProvider() === 'ollama') {
    const content = await ollamaChat({
      model: models.reason,
      system: FACT_SYSTEM_PROMPT,
      user: userPrompt,
      json: true,
      temperature: 0,
      stream: false,
    });
    return parseFactResponse(content);
  }

  const response = await getNebiusClient().chat.completions.create({
    model: models.reason,
    temperature: 0,
    max_tokens: 120,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: FACT_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  });
  const content = response.choices[0]?.message?.content;
  return typeof content === 'string' ? parseFactResponse(content) : null;
}

const VISION_PROMPT =
  'Describe this screen for a coding assistant. Focus on visible apps, editor content, errors, terminal output, and UI state. Be concise.';

export async function describeScreen(input: ScreenInput): Promise<string> {
  const models = getModelIds();

  if (brainProvider() === 'ollama') {
    // Ollama vision takes RAW base64 (no data: prefix) in the message's images[].
    const content = await ollamaChat({
      model: models.vision,
      user: VISION_PROMPT,
      images: [cleanImageB64(input)],
      temperature: 0.2,
      stream: false,
    });
    if (content.trim().length === 0) throw new Error('Ollama vision returned empty content');
    return content.trim();
  }

  const dataUri = toImageDataUri(input);
  const response = await getNebiusClient().chat.completions.create({
    model: models.vision,
    temperature: 0.2,
    max_tokens: 400,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: VISION_PROMPT },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('Nebius vision returned empty content');
  }

  return content.trim();
}

// Ground a natural-language phrase to a box on the screenshot (the paw-on-the-pixel wedge). Uses qwen2.5-VL's
// NATIVE grounding format (bbox_2d in the image's own PIXEL coordinates) — the model grounds far better asked
// the way it was trained than with a bespoke schema/scale. parseGroundResponse normalizes those pixels to
// [0,1] using the JPEG dimensions threaded from captureScreen, and fails safe on anything malformed.
const GROUND_PROMPT = (phrase: string): string =>
  `Locate "${phrase}" in this screenshot. Output ONLY a JSON object and nothing else: ` +
  `{"bbox_2d": [x1, y1, x2, y2]} — the tight bounding box of that element in PIXEL coordinates of this image ` +
  `(x1,y1 = top-left corner, x2,y2 = bottom-right). If that element is not visible, output {"bbox_2d": null}.`;

/** Ground `phrase` to a normalized box on the screenshot, or null when the model can't find it. Fail-loud
 *  by design: a null (no box) makes roro show no paw / say "I can't find that" rather than point wrongly. */
export async function groundTarget(input: ScreenInput, phrase: string): Promise<GroundResult | null> {
  const models = getModelIds();
  const prompt = GROUND_PROMPT(phrase);

  if (brainProvider() === 'ollama') {
    const content = await ollamaChat({
      model: models.vision,
      user: prompt,
      images: [cleanImageB64(input)],
      temperature: 0,
      stream: false,
    });
    return parseGroundResponse(content, input.width, input.height);
  }

  const dataUri = toImageDataUri(input);
  const response = await getNebiusClient().chat.completions.create({
    model: models.vision,
    temperature: 0,
    max_tokens: 120,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      },
    ],
  });
  const content = response.choices[0]?.message?.content;
  return typeof content === 'string' ? parseGroundResponse(content, input.width, input.height) : null;
}

export async function embed(text: string): Promise<number[]>;
export async function embed(text: string[]): Promise<number[][]>;
export async function embed(text: string | string[]): Promise<number[] | number[][]> {
  assertEmbeddableInput(text);

  const models = getModelIds();
  const dim = embeddingDim();

  let vectors: number[][];
  if (brainProvider() === 'ollama') {
    vectors = await ollamaEmbed(models.embed, text);
  } else {
    const response = await getNebiusClient().embeddings.create({
      model: models.embed,
      input: text,
      encoding_format: 'float',
      dimensions: dim,
    });
    vectors = response.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }

  for (const vector of vectors) {
    if (vector.length !== dim) {
      throw new Error(`Expected ${dim}-dim embedding, got ${vector.length}`);
    }
  }

  return Array.isArray(text) ? vectors : vectors[0];
}

function getNebiusClient(): OpenAI {
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey) {
    throw new Error('NEBIUS_API_KEY is required for Nebius Brain calls');
  }

  if (!cachedClient || cachedApiKey !== apiKey) {
    cachedClient = new OpenAI({
      baseURL: NEBIUS_BASE_URL,
      apiKey,
      maxRetries: 2,
      timeout: 60_000,
    });
    cachedApiKey = apiKey;
  }

  return cachedClient;
}

function parseDecision(raw: string): Decision {
  const json = extractJsonObject(raw);
  const parsed = JSON.parse(json) as unknown;

  if (!isRecord(parsed)) {
    throw new Error(`Brain JSON was not an object: ${raw.slice(0, 200)}`);
  }

  const narration = parsed.narration;
  const command = parsed.command;
  const args = parsed.args;

  if (typeof narration !== 'string' || narration.trim().length === 0) {
    throw new Error(`Brain JSON missing narration: ${raw.slice(0, 200)}`);
  }

  if (!isCommand(command)) {
    throw new Error(`Brain JSON had invalid command: ${String(command)}`);
  }

  if (args !== undefined && !isRecord(args)) {
    throw new Error(`Brain JSON args must be an object for command ${command}`);
  }

  return {
    narration: narration.trim(),
    command,
    args: (args ?? {}) as Record<string, unknown>,
  };
}

/** Parse a grounding response ({"found":bool,"box":[x0,y0,x1,y1],"confidence":n}) into a normalized box,
 *  or null when not found / malformed. FAIL-SAFE: any bad parse yields NO box (roro shows no paw) rather
 *  than a confident wrong point. Tolerates 0-1000-scale boxes (a common VL convention) but not raw pixels. */
export function parseGroundResponse(raw: string, imgW?: number, imgH?: number): GroundResult | null {
  let json: string;
  try {
    json = extractJsonObject(raw);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.found === false) return null;
  if (parsed.bbox_2d === null) return null; // qwen2.5-VL "not visible" sentinel

  const b = parsed.bbox_2d ?? parsed.box; // prefer the native bbox_2d, accept a plain box too
  if (!Array.isArray(b) || b.length !== 4 || !b.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return null;
  }
  let [x0, y0, x1, y1] = b as [number, number, number, number];

  // Normalize scale. Coords ≤1.5 are already 0-1 fractions (slight model overshoot; clamped below).
  // Larger coords are qwen2.5-VL's native PIXEL coordinates of the input image → normalize PER-AXIS by the
  // known image size. Without image dims, fall back to a 0-1000 scale; anything else is unnormalizable → null.
  const maxCoord = Math.max(x0, y0, x1, y1);
  if (maxCoord > 1.5) {
    if (imgW && imgH && imgW > 0 && imgH > 0) {
      x0 /= imgW; x1 /= imgW; y0 /= imgH; y1 /= imgH;
    } else if (maxCoord <= 1000) {
      x0 /= 1000; y0 /= 1000; x1 /= 1000; y1 /= 1000;
    } else {
      return null;
    }
  }

  const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
  x0 = clamp01(x0); y0 = clamp01(y0); x1 = clamp01(x1); y1 = clamp01(y1);
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  if (w <= 0 || h <= 0) return null; // degenerate box — treat as not found

  // The native bbox_2d format carries no confidence; a returned box means the model located it, so default
  // to a confident (tight-ring) value. An explicit low `confidence` (if a provider gives one) still widens.
  const confRaw = parsed.confidence;
  const confidence = typeof confRaw === 'number' && Number.isFinite(confRaw) ? clamp01(confRaw) : 0.8;
  return { box: { x: left, y: top, w, h }, confidence };
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Brain returned no JSON object: ${raw.slice(0, 200)}`);
  }

  return withoutFence.slice(start, end + 1);
}

/** Validate a screen capture and return its whitespace-stripped raw base64 (no data: prefix). */
function cleanImageB64(input: ScreenInput): string {
  if (!input.b64.trim()) {
    throw new Error('describeScreen requires a non-empty b64 image');
  }
  if (!/^image\/[a-z0-9.+-]+$/i.test(input.mime)) {
    throw new Error(`describeScreen mime must be an image/* type, got ${input.mime}`);
  }
  if (/^data:/i.test(input.b64.trim())) {
    throw new Error('describeScreen expects raw base64 image data, not a data URI');
  }
  return input.b64.replace(/\s+/g, '');
}

function toImageDataUri(input: ScreenInput): string {
  return `data:${input.mime};base64,${cleanImageB64(input)}`;
}

function assertEmbeddableInput(input: string | string[]): void {
  if (typeof input === 'string') {
    if (input.length === 0) {
      throw new Error('embed requires a non-empty string');
    }
    return;
  }

  if (input.length === 0) {
    throw new Error('embed requires at least one string');
  }

  for (const item of input) {
    if (item.length === 0) {
      throw new Error('embed does not accept empty strings');
    }
  }
}

function isCommand(value: unknown): value is Command {
  return typeof value === 'string' && COMMANDS.indexOf(value as Command) !== -1;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
