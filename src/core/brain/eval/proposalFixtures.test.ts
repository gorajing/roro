import { describe, expect, it } from 'vitest';
import { codexFixtureDigest, claudeFixtureDigest } from './proposalFixtures';
import { parseProposals, admitProposals, isGroundedInDigest } from '../../orchestrator/factProposals/admission';
import { buildProposalPrompt } from '../../orchestrator/factProposals/prompt';

// The proposal eval's PURE half, in CI (the split the eval-metric-DOA lesson demands: protect
// production deterministically here; measure the model live in runProposalEval.ts). These tests pin
// (a) that the replayed executor fixtures produce REAL-SHAPED digests — if a mapper or the digest
// accumulator drifts, the eval's deterministic tier fails loudly instead of silently scoring against
// an empty digest — and (b) that parse+admit behaves correctly over exactly those digests with
// canned model replies (grounded admitted; ungrounded/boolean/garbage dropped).

describe('proposal eval fixture digests — real-shaped, straight from the production mappers', () => {
  it('codex: the captured v0.139.0 run digests to 2 commands, 1 added file, 4 messages, no finalText', () => {
    const d = codexFixtureDigest();
    expect(d.agent).toBe('codex');
    expect(d.outcome).toBe('completed');
    expect(d.task.length).toBeGreaterThan(0);
    expect(d.commands).toHaveLength(2);
    expect(d.commands[1]).toContain('python3 hello.py');
    expect(d.files).toEqual([{ path: '/tmp/companion_scratch/hello.py', op: 'add' }]);
    expect(d.messages).toHaveLength(4);
    expect(d.finalText).toBeUndefined(); // codex run.completed carries no finalText — same as production
  });

  it('claude: the documented 2.1.x sample digests to 1 command, 1 message, and a finalText', () => {
    const d = claudeFixtureDigest();
    expect(d.agent).toBe('claude');
    expect(d.outcome).toBe('completed');
    expect(d.commands).toEqual(['python3 hello.py']);
    expect(d.messages).toEqual(["I'll create hello.py for you."]);
    expect(d.finalText).toBe('Created hello.py and verified it prints hi.');
    // Pinned production behavior, not an aspiration: the claude mapper carries files on the STARTED
    // event while the digest accumulator collects only COMPLETED file_change events, so claude-channel
    // digests currently have zero files. If either side changes, this fails and the eval learns files.
    expect(d.files).toEqual([]);
  });

  it('both digests produce a non-empty proposal prompt (the live tier asks about exactly these)', () => {
    for (const d of [codexFixtureDigest(), claudeFixtureDigest()]) {
      const prompt = buildProposalPrompt(d);
      expect(prompt).toContain(d.task);
      expect(prompt).toContain('COMMANDS YOU RAN');
    }
  });
});

describe('parse+admit over the fixture digests (canned replies — the deterministic tier)', () => {
  const codex = codexFixtureDigest();
  const claude = claudeFixtureDigest();

  it('admits a proposal grounded in a codex digest message', () => {
    const reply = '[{"key":"verification_style","value":"runs scripts once to verify output","evidence":"run it once to confirm the output"}]';
    const admitted = admitProposals(parseProposals(reply), { digest: codex, existing: [] });
    expect(admitted).toHaveLength(1);
    expect(admitted[0].normalizedKey).toBe('verification_style');
  });

  it('admits a proposal grounded in the claude digest finalText', () => {
    const reply = '[{"key":"verification_style","value":"checks that new scripts actually run","evidence":"verified it prints hi"}]';
    const admitted = admitProposals(parseProposals(reply), { digest: claude, existing: [] });
    expect(admitted).toHaveLength(1);
  });

  it('drops an ungrounded proposal — evidence appears in NEITHER fixture digest', () => {
    const reply = '[{"key":"pkg_manager","value":"prefers pnpm for installs","evidence":"the user prefers pnpm for everything"}]';
    expect(admitProposals(parseProposals(reply), { digest: codex, existing: [] })).toEqual([]);
    expect(admitProposals(parseProposals(reply), { digest: claude, existing: [] })).toEqual([]);
  });

  it('drops a grounded-but-boolean value (the shared isUselessValue guard)', () => {
    const reply = '[{"key":"verifies_output","value":"true","evidence":"run it once to confirm the output"}]';
    expect(admitProposals(parseProposals(reply), { digest: codex, existing: [] })).toEqual([]);
  });

  it('top-level garbage and the empty array both yield zero proposals without throwing', () => {
    expect(parseProposals('the run looked routine to me')).toEqual([]);
    expect(parseProposals('[]')).toEqual([]);
  });

  it('isGroundedInDigest matches admission: verbatim-substring yes, paraphrase/too-short no', () => {
    expect(isGroundedInDigest('run it once to confirm the output', codex)).toBe(true);
    expect(isGroundedInDigest('ran the script a single time to check', codex)).toBe(false); // paraphrase
    expect(isGroundedInDigest('hello.py', codex)).toBe(false); // under the 12-char floor
  });
});
