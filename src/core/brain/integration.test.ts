// src/brain/integration.test.ts — OPT-IN smoke test against a LIVE Ollama daemon.
//
// Every other test mocks/injects the embedder and never hits the daemon, so the local brain had
// never been observed actually working. This test proves the full local stack end-to-end:
// tags reachable -> preflight passes -> decide() streams a well-formed Decision -> embed() returns
// the right dimension -> describeScreen() captions an image via the vision model.
//
// SKIPPED unless OLLAMA_AVAILABLE=1, so normal `npm test` / CI never blocks on a running daemon and
// multi-GB model pulls. Run it on a real machine with the daemon up + models pulled:
//   OLLAMA_AVAILABLE=1 npx vitest run src/brain/integration.test.ts
// Respects OLLAMA_HOST (default http://127.0.0.1:11434).
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { preflight, decide, embed, describeScreen } from './index';
import { ollamaTags } from './ollama';

const LIVE = process.env.OLLAMA_AVAILABLE === '1';

// A valid small solid-color PNG (base64, no data: prefix) generated with sharp — exercises the vision
// round-trip without depending on real screen state or a brittle hardcoded fixture.
async function syntheticPngB64(): Promise<string> {
  const png = await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 90, g: 140, b: 200 } },
  })
    .png()
    .toBuffer();
  return png.toString('base64');
}

describe.skipIf(!LIVE)('LIVE Ollama brain smoke (opt-in: OLLAMA_AVAILABLE=1)', () => {
  it('the daemon is reachable and the configured models are pulled', async () => {
    const tags = await ollamaTags();
    expect(tags.length).toBeGreaterThan(0);
    const result = await preflight();
    expect(result.missing).toEqual([]);
  }, 60_000);

  it('decide() streams content and returns a well-formed Decision', async () => {
    const deltas: string[] = [];
    const decision = await decide(
      { transcript: 'Just answer: say hello. Do not run any tools.' },
      { onContent: (d) => deltas.push(d) },
    );
    expect(typeof decision.narration).toBe('string');
    expect(['run_agent', 'answer', 'capture_screen', 'clarify']).toContain(decision.command);
    expect(deltas.join('').length).toBeGreaterThan(0); // proves content actually streamed
  }, 120_000);

  it('embed() returns a finite vector of the configured dimension', async () => {
    const vec = (await embed('the quick brown fox')) as number[];
    expect(Array.isArray(vec)).toBe(true);
    expect(vec.length).toBe(768); // nomic-embed-text default
    expect(vec.every((n) => typeof n === 'number' && Number.isFinite(n))).toBe(true);
  }, 60_000);

  it('describeScreen() captions a synthetic image via the vision model', async (ctx) => {
    try {
      const caption = await describeScreen({ b64: await syntheticPngB64(), mime: 'image/png' });
      expect(typeof caption).toBe('string');
      expect(caption.trim().length).toBeGreaterThan(0);
    } catch (err) {
      const message = (err as Error).message;
      // qwen2.5vl:7b needs substantial RAM (~13-17GB at its default context); on a memory-constrained
      // machine the runner OOMs. That's a hardware limit, not a code defect — skip (with the reason)
      // rather than fail the opt-in smoke. On a capable machine this assertion runs for real.
      if (/resource limitations|model runner has unexpectedly stopped/i.test(message)) {
        console.warn(`[integration] vision smoke skipped — vision model could not load: ${message}`);
        ctx.skip();
        return;
      }
      throw err;
    }
  }, 120_000);
});
