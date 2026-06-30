import { describe, it, expect } from 'vitest';
import { isEventful, observationSignature, isNewObservation, type AmbientObservation } from './belief';

const obs = (o: Partial<AmbientObservation> = {}): AmbientObservation => ({ kind: 'change', app: 'terminal', what: 'test_login FAILED', ...o });

describe('isEventful', () => {
  it('change and risk are eventful', () => {
    expect(isEventful(obs({ kind: 'change' }))).toBe(true);
    expect(isEventful(obs({ kind: 'risk' }))).toBe(true);
  });
  it('idle and unknown are not', () => {
    expect(isEventful(obs({ kind: 'idle' }))).toBe(false);
    expect(isEventful(obs({ kind: 'unknown' }))).toBe(false);
  });
});

describe('observationSignature', () => {
  it('is stable across reordered descriptions with the same key words (order-independent)', () => {
    const a = observationSignature(obs({ what: 'test_login FAILED auth' }));
    const b = observationSignature(obs({ what: 'auth: FAILED, test_login' }));
    expect(a).toBe(b);
  });
  it('ignores volatile numbers/durations', () => {
    const a = observationSignature(obs({ what: 'build finished in 12.3s' }));
    const b = observationSignature(obs({ what: 'build finished in 0.4s' }));
    expect(a).toBe(b);
  });
  it('does not collide when only later subject words differ (uses the full token set, no truncation)', () => {
    const a = observationSignature(obs({ what: 'actual auth build button expected payment failed' }));
    const b = observationSignature(obs({ what: 'actual auth build button expected settings failed' }));
    expect(a).not.toBe(b);
  });

  it('differs when the kind, app, or subject differs', () => {
    expect(observationSignature(obs({ kind: 'change' }))).not.toBe(observationSignature(obs({ kind: 'risk' })));
    expect(observationSignature(obs({ app: 'terminal' }))).not.toBe(observationSignature(obs({ app: 'editor' })));
    expect(observationSignature(obs({ what: 'test_login FAILED' }))).not.toBe(observationSignature(obs({ what: 'database connection lost' })));
  });
});

describe('isNewObservation — edge-trigger latch', () => {
  it('fires once on a new event, then stays quiet on the same signature', () => {
    const o = obs();
    const sig = observationSignature(o);
    expect(isNewObservation(o, null)).toBe(true);   // first sighting
    expect(isNewObservation(o, sig)).toBe(false);   // repeat of the same thing
  });

  it('fires again when the situation actually changes', () => {
    const red = obs({ what: 'test_login FAILED' });
    const green = obs({ what: 'test_login PASSED' });
    expect(isNewObservation(green, observationSignature(red))).toBe(true);
  });

  it('never fires for non-events, even when the signature differs', () => {
    expect(isNewObservation(obs({ kind: 'idle' }), null)).toBe(false);
    expect(isNewObservation(obs({ kind: 'unknown' }), 'whatever')).toBe(false);
  });

  it('over a poll sequence (present, present, changed) it acts exactly on the edges', () => {
    const a = obs({ what: 'test_login FAILED' });
    const b = obs({ what: 'test_login PASSED' });
    const polls = [a, a, a, b, b];
    let lastSig: string | null = null;
    const acted = polls.map((o) => {
      const fire = isNewObservation(o, lastSig);
      if (fire) lastSig = observationSignature(o);
      return fire;
    });
    expect(acted).toEqual([true, false, false, true, false]);
  });
});
