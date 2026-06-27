import type { ActionEvent } from '../../shared/events';
import type { CaptionSink, CharacterDriver } from '../character/types';
import { getCompanion as defaultGetCompanion } from '../events/bridge';
import { actionableErrorCopy, isStoppedTerminalError } from '../events/errorCopy';
import { initialTurnReceiptState, receiptForTurnEnd, reduceTurnReceipt, type TurnReceiptState } from '../events/turnReceipt';
import type { BrainReadinessGate } from './brainReadiness';
import { ensureWorkdirReady, notifyWorkdirConfigured } from './workdirSetup';

type CompanionBridge = NonNullable<ReturnType<typeof defaultGetCompanion>>;

export interface TypedPromptDeps {
  captions: CaptionSink;
  driver: Pick<CharacterDriver, 'setBusy' | 'setState'>;
  brainGate: Pick<BrainReadinessGate, 'ensureReady'>;
  sessionId: string;
  setStatus(text: string): void;
  getCompanion?: () => CompanionBridge | undefined;
}

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export function mountTypedPrompt(deps: TypedPromptDeps): () => void {
  const { captions, driver, brainGate, sessionId, setStatus } = deps;
  const getCompanion = deps.getCompanion ?? defaultGetCompanion;

  const promptForm = el<HTMLFormElement>('prompt-form');
  const promptInput = el<HTMLInputElement>('prompt-input');
  const sendBtn = el<HTMLButtonElement>('send-btn');
  const cancelBtn = el<HTMLButtonElement>('cancel-btn');
  const unsubs: Array<() => void> = [];

  let turnInFlight = false;
  let cancelRequested = false;
  let acceptedRunId: string | null = null;
  let turnSerial = 0;
  let activeTurnSerial = 0;
  let receiptState: TurnReceiptState = initialTurnReceiptState();

  function setCancelIdle(): void {
    if (!cancelBtn) return;
    cancelBtn.textContent = 'Stop';
    cancelBtn.disabled = true;
  }

  function setCancelArmed(): void {
    if (!cancelBtn) return;
    cancelBtn.textContent = 'Stop';
    cancelBtn.disabled = false;
  }

  function setCancelStopping(): void {
    if (!cancelBtn) return;
    cancelBtn.textContent = 'Stopping...';
  }

  function eventBelongsToTypedTurn(runId: string): boolean {
    return turnInFlight && (acceptedRunId === null || acceptedRunId === runId);
  }

  function releaseTypedTurn(): void {
    activeTurnSerial = 0;
    acceptedRunId = null;
    turnInFlight = false;
    if (sendBtn) sendBtn.disabled = false;
    setCancelIdle();
    if (promptInput) promptInput.value = '';
  }

  function handleActionEvent(e: ActionEvent): void {
    if (eventBelongsToTypedTurn(e.runId)) receiptState = reduceTurnReceipt(receiptState, e);

    if (e.kind === 'run.started') {
      if (!eventBelongsToTypedTurn(e.runId)) return;
      acceptedRunId = e.runId;
      driver.setBusy?.(true);
      setCancelArmed();
      setStatus('Working on it - click Stop if you need to pause.');
      return;
    }

    if (e.kind === 'run.completed') {
      if (!eventBelongsToTypedTurn(e.runId)) return;
      driver.setBusy?.(false);
      setCancelIdle();
      return;
    }

    if (e.kind === 'run.failed') {
      if (!eventBelongsToTypedTurn(e.runId)) return;
      const stopped = cancelRequested || isStoppedTerminalError(e.error);
      cancelRequested = cancelRequested || stopped;
      driver.setBusy?.(false);
      setCancelIdle();
      setStatus(stopped ? 'Stopped.' : `Task hit a problem: ${actionableErrorCopy(e.error)}`);
    }
  }

  function handleRunEnd(p: { runId: string }): void {
    if (!turnInFlight) return;
    if (acceptedRunId !== null && p.runId !== acceptedRunId) return;
    const receipt = receiptForTurnEnd(receiptState, cancelRequested);
    setStatus(receipt.text);
    receiptState = initialTurnReceiptState();
    releaseTypedTurn();
  }

  async function handleSubmit(ev: Event): Promise<void> {
    ev.preventDefault();
    if (turnInFlight) return;
    const text = promptInput?.value.trim() ?? '';
    if (!text) return;

    const companion = getCompanion();
    if (!companion?.turnRun) {
      console.warn('[bootstrap] Roro bridge unavailable: window.companion.turnRun missing.');
      setStatus('Roro lost its connection. Reopen Roro and try again.');
      return;
    }

    const workdirReady = await ensureWorkdirReady({
      getConfig: () => companion.getWorkdirConfig?.() ?? Promise.resolve({ source: 'unset' }),
      chooseWorkdir: () => companion.chooseWorkdir?.() ?? Promise.resolve({ source: 'unset' }),
      onStatus: setStatus,
      onConfigured: notifyWorkdirConfigured,
    });
    if (!workdirReady) return;

    if (!brainGate.ensureReady(setStatus)) return;

    const turnToken = ++turnSerial;
    activeTurnSerial = turnToken;
    acceptedRunId = null;
    turnInFlight = true;
    cancelRequested = false;
    receiptState = initialTurnReceiptState();
    if (sendBtn) sendBtn.disabled = true;
    setCancelArmed();
    captions.update('user', text, true);
    driver.setState('thinking');
    setStatus('Thinking... click Stop if you need to pause.');

    try {
      const { runId } = await companion.turnRun({ transcript: text, sessionId });
      if (activeTurnSerial !== turnToken || !turnInFlight) return;
      acceptedRunId = runId;
      if (cancelRequested) void companion.cancelTask?.(runId);
    } catch (e) {
      if (activeTurnSerial !== turnToken || !turnInFlight) return;
      driver.setState('error');
      setStatus(`Task hit a problem: ${actionableErrorCopy(describeError(e))}`);
      releaseTypedTurn();
    }
  }

  async function handleCancel(): Promise<void> {
    if (!turnInFlight) return;
    const companion = getCompanion();
    if (!companion?.cancelTask) return;
    cancelRequested = true;
    setCancelStopping();
    setStatus('Stopping...');
    try {
      await companion.cancelTask(acceptedRunId ?? undefined);
    } catch (e) {
      setStatus(`Stop failed: ${describeError(e)}`);
    }
  }

  promptForm?.addEventListener('submit', handleSubmit);
  cancelBtn?.addEventListener('click', handleCancel);

  const companion = getCompanion();
  if (companion?.onActionEvent) unsubs.push(companion.onActionEvent(handleActionEvent));
  if (companion?.onRunEnd) unsubs.push(companion.onRunEnd(handleRunEnd));

  return () => {
    promptForm?.removeEventListener('submit', handleSubmit);
    cancelBtn?.removeEventListener('click', handleCancel);
    for (const unsub of unsubs) unsub();
  };
}
