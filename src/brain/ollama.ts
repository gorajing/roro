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
}

/** Call /api/chat. Streams incrementally (firing onContent) when stream is true. */
export async function ollamaChat(opts: OllamaChatOpts): Promise<string> {
  const messages: ChatMessage[] = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: opts.user, ...(opts.images ? { images: opts.images } : {}) });
  const stream = opts.stream ?? false;
  const body = buildChatBody({ model: opts.model, messages, stream, json: opts.json, temperature: opts.temperature });

  const res = await fetchOllama('/api/chat', body);
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
    res = await fetch(`${ollamaHost()}/api/tags`);
  } catch (err) {
    throw new Error(`Ollama daemon unreachable at ${ollamaHost()} (${(err as Error).message}). Start it with: ollama serve`);
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

async function fetchOllama(path: string, body: unknown): Promise<Response> {
  const url = `${ollamaHost()}${path}`;
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Connection refused / DNS / network: the daemon almost certainly isn't running.
    throw new Error(
      `Ollama daemon unreachable at ${ollamaHost()} (${(err as Error).message}). Start it with: ollama serve`,
    );
  }
}
