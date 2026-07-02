// src/executor/claudeSdkGate.ts — the PURE permission-adjudication core for the Agent-SDK executor.
//
// W6 turns the destructive-Bash gate from post-hoc regex ABORT into PRE-EXECUTION default-deny.
// The Agent SDK exposes two pre-execution seams (both probed live — claudeSdk.probes.live.test.ts):
//   - a PreToolUse hook (matcher 'Bash') — the HARD invariant. Hooks precede EVERYTHING, including
//     the CLI's acceptEdits auto-approval that would otherwise run a workspace `rm -rf` unasked (P2b).
//   - canUseTool — the backstop for whatever the CLI did NOT auto-approve (P2, permissionMode
//     'default').
// This module is the ONE adjudication delegate BOTH seams call. It is PURE: an injected port
// (classify + ask + onCleared), ZERO electron/SDK imports, so it unit-tests without a subprocess.
// The adapter (claudeSdk.ts) maps its neutral decision onto each seam's return shape.
//
// Invariants encoded here:
//   - MEMOIZED per toolUseId: the hook and canUseTool for the SAME tool call share ONE decision
//     (one in-flight ask promise) — no double-ask by construction.
//   - PRE-SCREEN: only classify()-positive (destructive) commands ask. Non-destructive commands
//     clear silently — identical confirm-fatigue exposure to today's classifier, false negatives
//     included (documented, not fixed here).
//   - DENY-CONTINUES: deny/timeout denies THE TOOL CALL (the run keeps going to its own verdict);
//     it never throws and never aborts the run. The deny message tells the model not to retry
//     destructive variants.
//   - REASON-CLASS memoization: an approval (pre-dispatch via preApprovedReason, or a mid-run
//     approval) waives every later ask of the SAME reason class this run; a deny memoizes the deny
//     for that class (no re-ask). A DIFFERENT class asks once.
//   - LEDGER + TRIPWIRE: approved-destructive toolUseIds are recorded (onCleared) so the pump's
//     post-hoc guard is a no-op-by-construction for SDK runs; wasAdjudicated() lets the adapter
//     fail loud on a Bash tool_result whose id never traversed the gate (gate-bypass tripwire).
//     Keyed by toolUseId — NEVER by command-string equality.

import type { DestructiveVerdict } from '../orchestrator/destructive';

/** The port startPump injects (an additive, optional ExecutorRunOptions.gate). Pure of electron. */
export interface DestructiveGate {
  /** Classify a Bash command in workspace context — classifyDestructiveCommand(cmd, repo) bound. */
  classify: (command: string) => DestructiveVerdict;
  /** Ask the user to approve a destructive command by its reason class. Resolves true=approved.
   *  The adapter's closure wraps confirmGate.requestConfirm UNCHANGED (15s default-DENY) and
   *  resolves false synchronously on a Stop (the Stop-race path). */
  ask: (reason: string) => Promise<boolean>;
  /** The pre-dispatch destructiveConfirm approval's reason class (from ctx.destructiveReason).
   *  Seeds the approved-class set so the identical mid-run command never re-asks. */
  preApprovedReason?: string;
  /** Record an approved-destructive toolUseId in the orchestrator-side ledger (the pump guard
   *  consults it so it can't re-block a gate-approved command). Keyed by toolUseId. */
  onCleared: (toolUseId: string) => void;
}

/** The gate's neutral decision. The adapter maps allow→hook{} / canUseTool allow, deny→hook deny /
 *  canUseTool deny{message,interrupt:false}. */
export type SdkGateDecision =
  | { behavior: 'allow' }
  | { behavior: 'deny'; message: string };

export interface SdkGate {
  /** Adjudicate a Bash tool call. Memoized per toolUseId — the hook and canUseTool for the same
   *  call get the SAME in-flight decision, so a destructive command is asked AT MOST once. */
  adjudicate(toolUseId: string, command: string): Promise<SdkGateDecision>;
  /** Did this toolUseId traverse the gate? The gate-bypass tripwire: a Bash tool_result whose id
   *  is unknown here means execution slipped past both seams — the adapter fails the run loud. */
  wasAdjudicated(toolUseId: string): boolean;
  /** Was this toolUseId a destructive command the gate APPROVED? (the pump-guard no-op predicate). */
  wasApprovedDestructive(toolUseId: string): boolean;
}

const DEFAULT_REASON = 'destructive command';

/** The deny message fed to the model — steers it away from retrying destructive variants. */
export function gateDenyMessage(reason: string): string {
  return (
    `roro blocked a destructive command (${reason}) — the user did not approve it. ` +
    `Do not run it or any destructive variant; continue with the rest of the task.`
  );
}

/**
 * Build the per-run adjudication delegate. One instance per SDK run (created in runClaudeSdk from
 * the injected DestructiveGate); its memo maps live for that run only.
 */
export function createSdkGate(runId: string, gate: DestructiveGate): SdkGate {
  // Memoized decision PER tool call (the promise, so concurrent hook+canUseTool calls share one
  // in-flight ask). Key includes runId to match the spec's `${runId}:${toolUseID}` even though the
  // instance is already per-run.
  const decisions = new Map<string, Promise<SdkGateDecision>>();
  // Reason-class memory for the run. preApprovedReason seeds the approved set (the pre-dispatch
  // confirm already covered that class), so an identical mid-run command never re-asks.
  const approvedClasses = new Set<string>();
  const deniedClasses = new Set<string>();
  if (gate.preApprovedReason) approvedClasses.add(gate.preApprovedReason);
  // Every toolUseId that reached the gate (the tripwire's "traversed the gate" record).
  const adjudicated = new Set<string>();
  // Approved-destructive toolUseIds (the ledger the pump guard consults).
  const approvedDestructive = new Set<string>();

  async function decide(toolUseId: string, command: string): Promise<SdkGateDecision> {
    const verdict = gate.classify(command);
    if (!verdict.destructive) return { behavior: 'allow' }; // pre-screen: non-destructive never asks
    const reasonClass = verdict.reason ?? DEFAULT_REASON;

    // Reason-class memo — decide without re-asking when this class was already settled.
    if (approvedClasses.has(reasonClass)) return clearDestructive(toolUseId);
    if (deniedClasses.has(reasonClass)) return { behavior: 'deny', message: gateDenyMessage(reasonClass) };

    const approved = await gate.ask(reasonClass);
    if (approved) {
      approvedClasses.add(reasonClass);
      return clearDestructive(toolUseId);
    }
    deniedClasses.add(reasonClass); // memoize the deny for this class (no re-ask this run)
    return { behavior: 'deny', message: gateDenyMessage(reasonClass) };
  }

  function clearDestructive(toolUseId: string): SdkGateDecision {
    approvedDestructive.add(toolUseId);
    gate.onCleared(toolUseId); // record in the orchestrator ledger so the pump guard can't re-block it
    return { behavior: 'allow' };
  }

  return {
    adjudicate(toolUseId, command) {
      adjudicated.add(toolUseId);
      const key = `${runId}:${toolUseId}`;
      const existing = decisions.get(key);
      if (existing) return existing;
      const pending = decide(toolUseId, command);
      decisions.set(key, pending);
      return pending;
    },
    wasAdjudicated: (toolUseId) => adjudicated.has(toolUseId),
    wasApprovedDestructive: (toolUseId) => approvedDestructive.has(toolUseId),
  };
}
