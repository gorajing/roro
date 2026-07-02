// packages/voice/src/sentenceSplit.ts — chunk assistant text for streamed Kokoro synthesis.
//
// Kokoro (raw-ONNX, no kokoro-js) has no license-clean streaming generator, so we synthesize per chunk and
// play chunk N while chunk N+1 synthesizes — the cat starts talking after the first sentence. Each chunk
// must also stay well under Kokoro's ~509 phoneme-token ceiling; an over-long sentence (few/no terminators)
// is sub-split on clause punctuation, then hard-wrapped on whitespace as a last resort. Pure + unit-tested.

const MAX_CHUNK_CHARS = 300; // comfortably under the ~509-token Kokoro ceiling for English

/** Split into clause-sized pieces when a single sentence is too long for one synth pass. */
function splitLong(sentence: string): string[] {
  if (sentence.length <= MAX_CHUNK_CHARS) return [sentence];
  const out: string[] = [];
  let buf = '';
  // Break after clause punctuation (comma/semicolon/colon/dash), keeping the delimiter with its clause.
  for (const clause of sentence.split(/(?<=[,;:—-])\s+/)) {
    if (buf && (buf + ' ' + clause).length > MAX_CHUNK_CHARS) {
      out.push(buf);
      buf = clause;
    } else {
      buf = buf ? `${buf} ${clause}` : clause;
    }
  }
  if (buf) out.push(buf);
  // Any remaining over-long piece (a clause with no inner punctuation) is hard-wrapped on word boundaries.
  return out.flatMap((c) => (c.length <= MAX_CHUNK_CHARS ? [c] : hardWrap(c)));
}

function hardWrap(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  for (const word of text.split(/\s+/)) {
    if (buf && (buf + ' ' + word).length > MAX_CHUNK_CHARS) {
      out.push(buf);
      buf = word;
    } else {
      buf = buf ? `${buf} ${word}` : word;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/** Assistant text → ordered chunks ready for per-chunk synthesis. Empty/whitespace → []. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/) // after a sentence terminator + whitespace; the terminator stays on the chunk
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .flatMap(splitLong);
}
