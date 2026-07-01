// src/brain/ollama.ts — the LOCAL Ollama provider (chat + embeddings + vision) for the brain.
//
// Replaces the Nebius cloud calls with the local Ollama daemon (default http://127.0.0.1:11434).
// The PURE request-builders + NDJSON stream accumulation are split out so they unit-test without a
// daemon; the thin fetch callers fail LOUD with a actionable message when the daemon is unreachable
// (we are local-first by default — a silent cloud fallback would mask "ollama serve isn't running").

declare const process: { env: Record<string, string | undefined> };

const DEFAULT_HOST = 'http://127.0.0.1:11434';

export function ollamaHost(): string {
  return process.env.OLLAMA_HOST || DEFAULT_HOST;
}

/** Per-call timeout for Ollama fetches. A wedged daemon (TCP-connected but never responding) would otherwise
 *  hang the whole turn forever; this bounds it. Generous by default (covers a slow first token / model load)
 *  and overridable via OLLAMA_TIMEOUT_MS. */
function ollamaTimeoutMs(): number {
  const v = Number(process.env.OLLAMA_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 120_000;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** base64 image data (no data: prefix) for vision models. */
  images?: string[];
}

export interface ChatBodyOpts {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  /** Force strict JSON output (Ollama `format:"json"`). */
  json?: boolean;
  temperature?: number;
}

/** PURE: build the POST body for /api/chat. */
export function buildChatBody(opts: ChatBodyOpts): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream: opts.stream,
  };
  if (opts.json) body.format = 'json';
  if (opts.temperature !== undefined) body.options = { temperature: opts.temperature };
  return body;
}

/** PURE: parse ONE NDJSON line from /api/chat. Returns the content delta ('' if none) + done flag. */
export function parseChatLine(line: string): { delta: string; done: boolean } {
  const s = line.trim();
  if (!s) return { delta: '', done: false };
  let obj: unknown;
  try {
    obj = JSON.parse(s);
  } catch {
    return { delta: '', done: false }; // tolerate partial/garbage lines
  }
  const o = obj as { message?: { content?: unknown }; done?: unknown };
  const delta = typeof o.message?.content === 'string' ? o.message.content : '';
  return { delta, done: o.done === true };
}

/** One /api/pull progress line (M7b): a status + optional byte counts. */
export interface PullProgress {
  status: string;
  total?: number;
  completed?: number;
  /** completed/total as 0-100 (capped), present only when total>0. */
  percent?: number;
}

/**
 * PURE: parse one /api/pull NDJSON line. Returns null for a blank/garbage/status-less line (skip it), and
 * THROWS on an {"error":…} line so a pull failure surfaces (fail-loud) rather than masquerading as progress.
 */
export function parsePullProgress(line: string): PullProgress | null {
  const s = line.trim();
  if (!s) return null;
  let obj: { status?: unknown; total?: unknown; completed?: unknown; error?: unknown };
  try {
    obj = JSON.parse(s);
  } catch {
    return null; // tolerate a partial/garbage line
  }
  if (typeof obj.error === 'string') throw new Error(`Ollama pull error: ${obj.error}`);
  if (typeof obj.status !== 'string') return null;
  const out: PullProgress = { status: obj.status };
  if (typeof obj.total === 'number' && obj.total > 0) {
    out.total = obj.total;
    if (typeof obj.completed === 'number') {
      out.completed = obj.completed;
      out.percent = Math.min(100, Math.round((obj.completed / obj.total) * 100));
    }
  }
  return out;
}

/** PURE: accumulate a full /api/chat NDJSON response into its content, firing onContent per delta. */
export function accumulateChatStream(ndjson: string, onContent?: (delta: string) => void): string {
  let content = '';
  for (const line of ndjson.split('\n')) {
    const { delta } = parseChatLine(line);
    if (delta) {
      content += delta;
      onContent?.(delta);
    }
  }
  return content;
}

/** PURE: build the POST body for /api/embed. */
export function buildEmbedBody(model: string, input: string | string[]): Record<string, unknown> {
  return { model, input };
}

/**
 * PURE: resolve the active local-embedder dimension. Defaults to 768 (nomic-embed-text); the
 * OLLAMA_EMBED_DIM override pairs with an OLLAMA_EMBED_MODEL override so a different-dimension local
 * embedder (mxbai-embed-large=1024, all-minilm=384, …) is actually usable. This is the SINGLE source
 * of truth shared by the brain (embed()'s check) and the memory store (vector(N) + the provenance
 * stamp) so they can never silently desync. A non-positive-integer override fails LOUD rather than
 * letting a NaN/garbage value reach the vector(N) schema.
 */
export function resolveOllamaEmbedDim(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 768;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`OLLAMA_EMBED_DIM must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return n;
}

/**
 * PURE: guard that a probed embedder's real output dimension matches the configured one. preflight()
 * only verifies the embed model is *pulled* — it cannot tell what dimension it emits — so without
 * this an OLLAMA_EMBED_MODEL override to a non-768 model would pass preflight and then fail cryptically
 * mid-turn (or store the wrong-sized vector). Fail LOUD at startup with the exact remedy instead.
 */
export function assertEmbedDimMatch(model: string, actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(
      `Ollama embed model "${model}" returns ${actual}-dim vectors but the memory store is configured ` +
        `for ${expected}-dim. Set OLLAMA_EMBED_DIM=${actual} (and recreate the memory store) to use this model.`,
    );
  }
}

export interface OllamaChatOpts {
  model: string;
  system?: string;
  user: string;
  /** base64 image data for vision. */
  images?: string[];
  json?: boolean;
  temperature?: number;
  stream?: boolean;
  onContent?: (delta: string) => void;
  /** Per-call request timeout override (ms). Vision calls need far longer than the reason-model default. */
  timeoutMs?: number;
}

/** Call /api/chat. Streams incrementally (firing onContent) when stream is true. */
export async function ollamaChat(opts: OllamaChatOpts): Promise<string> {
  const messages: ChatMessage[] = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: opts.user, ...(opts.images ? { images: opts.images } : {}) });
  const stream = opts.stream ?? false;
  const body = buildChatBody({ model: opts.model, messages, stream, json: opts.json, temperature: opts.temperature });

  const res = await fetchOllama('/api/chat', body, opts.timeoutMs);
  if (!res.ok) {
    throw new Error(`Ollama chat failed ${res.status}: ${await res.text().catch(() => '')}`);
  }

  if (!stream || !res.body) {
    const j = (await res.json()) as { message?: { content?: unknown } };
    const content = j.message?.content;
    if (typeof content !== 'string') throw new Error('Ollama chat returned no content');
    return content;
  }

  // Incremental read: decode chunks, split on newlines, process each complete NDJSON line live.
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let content = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const { delta } = parseChatLine(line);
      if (delta) {
        content += delta;
        opts.onContent?.(delta);
      }
    }
  }
  const { delta } = parseChatLine(buf); // trailing line without a newline
  if (delta) {
    content += delta;
    opts.onContent?.(delta);
  }
  return content;
}

/** Call /api/embed for one or many inputs; returns one vector per input, index-aligned. */
export async function ollamaEmbed(model: string, input: string | string[]): Promise<number[][]> {
  const res = await fetchOllama('/api/embed', buildEmbedBody(model, input));
  if (!res.ok) {
    throw new Error(`Ollama embed failed ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const j = (await res.json()) as { embeddings?: unknown };
  if (!Array.isArray(j.embeddings) || j.embeddings.some((v) => !Array.isArray(v))) {
    throw new Error('Ollama embed returned no embeddings');
  }
  return j.embeddings as number[][];
}

/** Installed model names from /api/tags (e.g. ['qwen2.5:3b', 'nomic-embed-text:latest']). */
export async function ollamaTags(): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(`${ollamaHost()}/api/tags`, { signal: AbortSignal.timeout(ollamaTimeoutMs()) });
  } catch (err) {
    throw new Error(ollamaFetchError(err));
  }
  if (!res.ok) throw new Error(`Ollama tags failed ${res.status}`);
  const j = (await res.json()) as { models?: Array<{ name?: unknown }> };
  return Array.isArray(j.models)
    ? j.models.map((m) => (typeof m.name === 'string' ? m.name : '')).filter((n) => n.length > 0)
    : [];
}

/** Whether `id` (e.g. 'nomic-embed-text' or 'qwen2.5:3b') is among installed tags (tolerating :latest). */
export function hasModel(tags: string[], id: string): boolean {
  return tags.includes(id) || tags.includes(`${id}:latest`);
}

/**
 * Stream `ollama pull <name>` (M7b): POST /api/pull and fire onProgress per NDJSON line until completion.
 * NO request timeout — a multi-GB pull legitimately takes minutes, and the streamed progress IS the liveness
 * signal (pass an AbortSignal to cancel). Throws on a non-OK response or an error line (fail-loud). Verify
 * against a live daemon (opt-in / on a device) — like the other ollama HTTP calls, it's integration-gated.
 */
export async function pullModel(
  name: string,
  onProgress?: (p: PullProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${ollamaHost()}/api/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: name, stream: true }),
    signal,
  });
  if (!res.ok) throw new Error(`Ollama pull failed ${res.status}: ${await res.text().catch(() => '')}`);
  if (!res.body) throw new Error('Ollama pull returned no stream');
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const emit = (line: string): void => {
    const p = parsePullProgress(line); // throws on an {"error":…} line → propagates (fail-loud)
    if (p) onProgress?.(p);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      emit(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  emit(buf); // trailing line without a newline
}

async function fetchOllama(path: string, body: unknown, timeoutMs?: number): Promise<Response> {
  const url = `${ollamaHost()}${path}`;
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // a wedged daemon must fail, not hang the turn — but vision calls need a longer bound (see callers).
      signal: AbortSignal.timeout(timeoutMs ?? ollamaTimeoutMs()),
    });
  } catch (err) {
    throw new Error(ollamaFetchError(err));
  }
}

/** Distinguish a TIMEOUT (daemon wedged / model loading) from an UNREACHABLE daemon — both are actionable,
 *  but the remedies differ. AbortSignal.timeout() rejects with a TimeoutError. */
function ollamaFetchError(err: unknown): string {
  if ((err as Error)?.name === 'TimeoutError') {
    return `Ollama timed out after ${ollamaTimeoutMs()}ms at ${ollamaHost()} (the daemon may be wedged or a model is still loading). Raise OLLAMA_TIMEOUT_MS, or restart it: ollama serve`;
  }
  // Connection refused / DNS / network: the daemon almost certainly isn't running.
  return `Ollama daemon unreachable at ${ollamaHost()} (${(err as Error).message}). Start it with: ollama serve`;
}
