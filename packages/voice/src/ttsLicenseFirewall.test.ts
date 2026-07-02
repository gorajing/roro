import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// THE NO-GPL FIREWALL. roro is MIT/$0 and ships an Electron bundle, so a GPLv3 dependency (eSpeak-ng, the
// usual Kokoro G2P) is unshippable. The trap: `phonemizer` DECLARES Apache-2.0 in npm but BUNDLES espeak-ng
// (GPLv3) in its dist — a license-checker would wrongly pass it. So we gate two ways:
//   A) dependency-graph ban — the carriers (phonemizer / kokoro-js, which statically imports phonemizer) must
//      not exist in the lockfile at all. This is the real guarantee: GPL code can't bundle if it isn't resolved.
//   B) bundle-content scan — the G2P we DO ship (phonemize, MIT) must contain zero eSpeak symbols, with a
//      positive control so the detector can't rot into a silent pass.
// NOTE: we deliberately do NOT scan for the bare string "phonemizer" — phonemize (our MIT G2P) names an
// internal object `phonemizer`, which is harmless. We target eSpeak-specific symbols only.

const BANNED = ['phonemizer', 'kokoro-js', 'espeakng', 'espeak-ng', 'node-espeak'];
const ESPEAK_SYMBOLS: RegExp[] = [/espeak_ng_/, /espeak_EVENT/, /espeakng\.worker/, /GNU GENERAL PUBLIC LICENSE/i];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(mjs|cjs|js)$/.test(entry)) yield p;
  }
}

describe('TTS license firewall — no eSpeak/GPL G2P', () => {
  it('A) the dependency graph contains none of the GPL/eSpeak carriers', () => {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as { packages?: Record<string, unknown> };
    const paths = Object.keys(lock.packages ?? {});
    for (const name of BANNED) {
      const hit = paths.find((p) => p === `node_modules/${name}` || p.endsWith(`/node_modules/${name}`));
      expect(hit, `Banned GPL/eSpeak dependency present in lockfile: ${name}`).toBeUndefined();
    }
  });

  it('B) the bundled G2P (phonemize) contains zero eSpeak symbols', () => {
    const dist = 'node_modules/phonemize/dist';
    expect(existsSync(dist), 'phonemize must be installed').toBe(true);
    const hits: string[] = [];
    for (const file of walk(dist)) {
      const txt = readFileSync(file, 'latin1');
      for (const re of ESPEAK_SYMBOLS) if (re.test(txt)) hits.push(`${file} :: ${re}`);
    }
    expect(hits, `eSpeak/GPL content in phonemize:\n${hits.join('\n')}`).toEqual([]);
  });

  it('B-control) the eSpeak detector actually matches a known eSpeak symbol (no silent rot)', () => {
    const sample = 'function espeak_ng_Synthesize(){} // espeakng.worker';
    expect(ESPEAK_SYMBOLS.some((re) => re.test(sample))).toBe(true);
  });
});
