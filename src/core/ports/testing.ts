// src/core/ports/testing.ts — the pin suites' platform-port harness.
//
// installTestPorts registers capturing doubles for the platform ports and returns the capture arrays,
// so a test can assert on what core pushed / notified / pointed without mocking electron. Any port can
// be overridden (the orchestrator pin suites override rendererPush to feed their own `sent` array in
// their existing capture shape, keeping their assertions byte-identical); un-overridden ports fall back
// to the capturing defaults below. Call __test.reset() (re-exported as resetTestPorts) in afterEach.
import type { NormalizedBox } from '../../shared/pointing';
import { setPlatformPorts, __test, type PlatformPorts } from './ports';

export interface TestPortCaptures {
  /** Every rendererPush.send(channel, ...args), unless rendererPush was overridden. */
  pushes: Array<{ channel: string; args: unknown[] }>;
  /** Every notification.show(...), unless notification was overridden. */
  notifications: Array<{ title: string; body: string }>;
  /** Every pointerOverlay.showPointForBox(box, confidence), unless pointerOverlay was overridden. */
  points: Array<{ box: NormalizedBox; confidence: number }>;
}

/** Register capturing platform ports (with optional per-port overrides) and return the capture arrays. */
export function installTestPorts(overrides: Partial<PlatformPorts> = {}): TestPortCaptures {
  const pushes: TestPortCaptures['pushes'] = [];
  const notifications: TestPortCaptures['notifications'] = [];
  const points: TestPortCaptures['points'] = [];
  const defaults: PlatformPorts = {
    rendererPush: { send: (channel, ...args) => { pushes.push({ channel, args }); return true; } },
    notification: { isSupported: () => true, show: (n) => { notifications.push(n); } },
    pointerOverlay: { showPointForBox: async (box, confidence) => { points.push({ box, confidence }); } },
    // Fail-loud: no unit test should reach the real memory2 cipher singleton (they inject ciphers via
    // createMemoryFacade/createMemoryStore). A test that genuinely needs it must override keyWrapper.
    keyWrapper: { getSafeStorage: () => { throw new Error('[ports] keyWrapper.getSafeStorage() not configured — override it in installTestPorts if a test exercises the memory cipher singleton'); } },
  };
  setPlatformPorts({
    rendererPush: overrides.rendererPush ?? defaults.rendererPush,
    notification: overrides.notification ?? defaults.notification,
    pointerOverlay: overrides.pointerOverlay ?? defaults.pointerOverlay,
    keyWrapper: overrides.keyWrapper ?? defaults.keyWrapper,
  });
  return { pushes, notifications, points };
}

/** Clear the platform-port registry (afterEach) so a later access fails loud again. */
export function resetTestPorts(): void {
  __test.reset();
}
