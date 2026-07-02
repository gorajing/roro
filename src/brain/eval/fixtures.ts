// src/brain/eval/fixtures.ts — the GOLDEN turn set the brain eval scores against.
//
// Hand-curated to be defensible against the SYSTEM_PROMPT contract (src/brain/index.ts): run_agent is the
// default for any coding/file/test/build task; answer is talk-only; capture_screen is ONLY for things
// visible on screen but not in the codebase; clarify is for genuinely ambiguous requests with no referent.
// Keep expectations UNAMBIGUOUS — the eval measures the model, so a wrong golden answer poisons the metric.
// Seed/grow this from real RORO_TRACE captures over time (the roadmap's M1 note).

import type { Command, DecideInput } from '../../shared/brain';
import type { FactExtractInput } from '../extractFact';
import type { ValueContract } from './score';

export interface DecideCase {
  id: string;
  input: DecideInput;
  expect: Command;
  note?: string;
}

export interface ExtractCase {
  id: string;
  input: FactExtractInput;
  expect: 'fact' | 'null';
  /** For BEHAVIORAL 'fact' cases: the descriptive-value contract scoreFactValue checks (value quality,
   *  separate from detection). Absent on the detection-only EXTRACT_CASES. */
  valueContract?: ValueContract;
  note?: string;
}

export const DECIDE_CASES: DecideCase[] = [
  // run_agent — the default for any coding/file/test/build/debug task
  { id: 'run-logout', input: { transcript: 'add a logout route to the api' }, expect: 'run_agent' },
  { id: 'run-fixtest', input: { transcript: 'fix the failing test in calc.py' }, expect: 'run_agent' },
  { id: 'run-refactor', input: { transcript: 'refactor the auth module to use async await' }, expect: 'run_agent' },
  { id: 'run-tests', input: { transcript: 'run the test suite' }, expect: 'run_agent' },
  { id: 'run-validate', input: { transcript: 'add input validation to the signup form' }, expect: 'run_agent' },
  { id: 'run-debug-build', input: { transcript: 'the build is broken, figure out why and fix it' }, expect: 'run_agent' },
  { id: 'run-writetest', input: { transcript: 'write a unit test for the date parser' }, expect: 'run_agent' },

  // answer — talk only, no coding action, no screen needed
  { id: 'ans-capabilities', input: { transcript: 'what can you do?' }, expect: 'answer' },
  { id: 'ans-closure', input: { transcript: 'explain what a closure is in javascript' }, expect: 'answer' },
  { id: 'ans-thanks', input: { transcript: 'thanks, that was perfect' }, expect: 'answer' },
  { id: 'ans-name', input: { transcript: "what's your name?" }, expect: 'answer' },
  { id: 'ans-greeting', input: { transcript: 'good morning' }, expect: 'answer' },

  // capture_screen — refers to something VISIBLE ON SCREEN, not in the codebase
  { id: 'cap-error', input: { transcript: "what's this error on my screen?" }, expect: 'capture_screen' },
  { id: 'cap-seeing', input: { transcript: 'look at what I am seeing right now' }, expect: 'capture_screen' },
  { id: 'cap-dialog', input: { transcript: 'what does this dialog box say?' }, expect: 'capture_screen' },
  { id: 'cap-terminal', input: { transcript: 'can you read the terminal output I am looking at?' }, expect: 'capture_screen' },
  { id: 'cap-browser', input: { transcript: 'what is in the browser tab I have open?' }, expect: 'capture_screen' },

  // clarify — genuinely ambiguous, no referent; the contract says ask ONE question
  { id: 'clar-fixit', input: { transcript: 'fix it' }, expect: 'clarify' },
  { id: 'clar-better', input: { transcript: 'make it better' }, expect: 'clarify' },
  { id: 'clar-thatthing', input: { transcript: 'do that thing we talked about' }, expect: 'clarify' },
  { id: 'clar-updateit', input: { transcript: 'update it' }, expect: 'clarify' },
  { id: 'clar-color', input: { transcript: 'change the color', }, expect: 'clarify', note: 'of what, to what — no referent' },
];

export const EXTRACT_CASES: ExtractCase[] = [
  // expect a durable fact — a stable preference / convention worth remembering across sessions
  { id: 'fact-pnpm', input: { transcript: 'from now on always use pnpm in this repo, never npm', narration: "Got it, I'll use pnpm.", outcome: 'completed' }, expect: 'fact' },
  { id: 'fact-tabs', input: { transcript: 'I prefer tabs over spaces for indentation', narration: 'Noted — tabs it is.', outcome: 'answered' }, expect: 'fact' },
  { id: 'fact-testsdir', input: { transcript: 'our tests always live in the tests directory', narration: 'Understood.', outcome: 'answered' }, expect: 'fact' },
  { id: 'fact-commitstyle', input: { transcript: 'I like my commit messages short and imperative', narration: 'Will do.', outcome: 'answered' }, expect: 'fact' },
  { id: 'fact-prettier', input: { transcript: 'always run prettier before committing in this project', narration: 'Okay, I will.', outcome: 'answered' }, expect: 'fact' },

  // expect null — a one-off task or chitchat with nothing durable; inventing a fact here rots the profile
  { id: 'null-logout', input: { transcript: 'add a logout route', narration: 'On it.', task: 'Add a logout route to the API', outcome: 'completed' }, expect: 'null' },
  { id: 'null-typo', input: { transcript: 'fix the typo on line 5 of the readme', narration: 'Fixed it.', outcome: 'completed' }, expect: 'null' },
  { id: 'null-thanks', input: { transcript: 'thanks', narration: "You're welcome!", outcome: 'answered' }, expect: 'null' },
  { id: 'null-runtests', input: { transcript: 'run the tests', narration: 'Running them now.', outcome: 'completed' }, expect: 'null' },
  { id: 'null-time', input: { transcript: 'what time is it', narration: 'It is just past noon.', outcome: 'answered' }, expect: 'null' },
];

/** The behavioral eval's case taxonomy — every BEHAVIORAL case is labeled with exactly one, so a low
 *  score is diagnosable per failure FAMILY (not just per case). Expected pipeline outcome per tag:
 *  - noun-preference:  fact + descriptive value (the 3B's strength — tool/config nouns).
 *  - behavioral-habit: fact + descriptive value (the measured 40% weakness — processes/habits).
 *  - hard-negative:    null FROM THE MODEL — the transcript contains a PREFERENCE_MARKER (so it passes
 *                      the gate and reaches the model) but states nothing durable; measures null-discipline.
 *  - marker-less:      null FROM THE GATE — a genuine preference stated WITHOUT any of the 17 markers.
 *                      isPlausiblePreference returns false and the model is never consulted: a known,
 *                      DELIBERATE miss (the safe direction). The fixture expects the gate outcome, not
 *                      fantasy extraction; fixtures.test.ts pins that these fail the gate, so growing the
 *                      marker list forces a loud re-label instead of a silent metric shift.
 *  - multi-fact:       one turn stating 2+ preferences; the pipeline stores AT MOST one, so the contract
 *                      accepts EITHER fact's tokens (any single usable extraction scores ok).
 *  - boolean-collapse: habits the 3B historically collapsed to value:"true" (the live finding). The
 *                      runtime guard (isUselessValue) nulls a collapsed value BEFORE the eval sees it, so
 *                      a collapse scores missed_fact — the user's true outcome (no recalled memory), the
 *                      eval-metric-DOA lesson (LESSONS.md: measure the model, don't re-check the guard).
 *  - supersede:        contradiction/switch phrasings ("we switched from X to Y"); the contract requires
 *                      the NEW value, so extracting the superseded tool scores off_topic. */
export type BehavioralTaxonomy =
  | 'noun-preference'
  | 'behavioral-habit'
  | 'hard-negative'
  | 'marker-less'
  | 'multi-fact'
  | 'boolean-collapse'
  | 'supersede';

export interface BehavioralCase extends ExtractCase {
  taxonomy: BehavioralTaxonomy;
}

// BEHAVIORAL preferences (habits/processes) — the kind the 3B model collapsed to value:"true" (the live
// finding). Kept SEPARATE from EXTRACT_CASES so the detection metric + baseline stay untouched. Scoring is
// per-expectation (runEval.ts): expect:'fact' cases land on the value-quality axis (scoreFactValue) via each
// valueContract — apples-to-apples with baseline.json's `behavioral` number; expect:'null' cases land on a
// separate behavioral null-discipline axis (scoreExtraction). Every gate-passing transcript carries a
// PREFERENCE_MARKER ('always'/'prefer'/…) so isPlausiblePreference passes and it reaches the model (a miss
// isolates VALUE quality, never a gate reason) — EXCEPT taxonomy 'marker-less', whose whole point is the
// gate. Each case is DISJOINT from the FACT_SYSTEM_PROMPT examples and from every other fixture
// (fixtures.test.ts enforces both via 4-gram checks).
export const BEHAVIORAL_EXTRACT_CASES: BehavioralCase[] = [
  // ── noun-preference: tool/config choices with a noun-shaped value (the 3B's strength) ──────────────
  // Contracts use whole-word-START matching (scoreFactValue) so tokens are robust: no bare 2-char tokens
  // like 'pr' (which would match 'prefers'/'approve'); 'lint' matches 'linter', 'test' matches 'tests'.
  { id: 'np-pkg-bun', taxonomy: 'noun-preference', input: { transcript: 'use bun to install dependencies here going forward', narration: 'Got it.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['bun'] } },
  { id: 'np-indent-2space', taxonomy: 'noun-preference', input: { transcript: 'I prefer 2-space indent for typescript', narration: 'Noted.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['indent', 'space'], minWords: 2 } },
  { id: 'np-commit-conventional', taxonomy: 'noun-preference', input: { transcript: 'stick to conventional commit messages in every repo I work in', narration: 'Will do.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['conventional', 'commit'], minWords: 2 } },
  { id: 'np-node22', taxonomy: 'noun-preference', input: { transcript: 'we use node 22 for all services, match that', narration: 'Understood.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['node'], minWords: 2 } },
  { id: 'np-editor-neovim', taxonomy: 'noun-preference', input: { transcript: 'I use neovim as my editor, keep instructions terminal-friendly', narration: 'Okay.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['neovim'] } },
  { id: 'np-ts-strict', taxonomy: 'noun-preference', input: { transcript: 'we always keep typescript strict mode on', narration: 'Got it.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['strict'], minWords: 2 } },
  { id: 'np-branch-naming', taxonomy: 'noun-preference', input: { transcript: 'our convention is feature branches named like feat/short-description', narration: 'Noted.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['feat', 'branch'], minWords: 2 } },
  { id: 'np-python-poetry', taxonomy: 'noun-preference', input: { transcript: 'I prefer poetry over pip for python projects', narration: 'Okay.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['poetry'] } },
  { id: 'np-css-tailwind', taxonomy: 'noun-preference', input: { transcript: "we use tailwind for styling, don't write raw css", narration: 'Will do.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['tailwind'] } },
  { id: 'np-db-postgres', taxonomy: 'noun-preference', input: { transcript: 'postgres is our default database, never suggest mysql', narration: 'Understood.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['postgres'] } },

  // ── behavioral-habit: processes/habits needing a DESCRIPTIVE value (the measured 40% weakness) ─────
  { id: 'beh-test-alongside', taxonomy: 'behavioral-habit', input: { transcript: 'I always write a test alongside each feature I build', narration: 'Got it.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['test', 'feature'], minWords: 2 } },
  { id: 'beh-lint-precommit', taxonomy: 'behavioral-habit', input: { transcript: 'I always run the linter before every commit', narration: 'Understood.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['lint'], minWords: 2 } },
  { id: 'beh-review-own', taxonomy: 'behavioral-habit', input: { transcript: 'I always review my own PRs before requesting review', narration: 'Noted.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['review', 'prs'], minWords: 2 } },
  { id: 'beh-changelog', taxonomy: 'behavioral-habit', input: { transcript: 'we always add a changelog entry for every change', narration: 'Will do.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['changelog', 'change log'], minWords: 2 } },
  { id: 'beh-small-prs', taxonomy: 'behavioral-habit', input: { transcript: 'I prefer to keep my pull requests small and focused', narration: 'Makes sense.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['small', 'focused', 'pull request'], minWords: 2 } },
  { id: 'beh-diff-before-commit', taxonomy: 'behavioral-habit', input: { transcript: 'I always read the full diff before I commit anything', narration: 'Noted.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['diff', 'commit'], minWords: 2 } },
  { id: 'beh-failing-test-first', taxonomy: 'behavioral-habit', input: { transcript: 'I usually write the failing test first, then the implementation', narration: 'Got it.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['test', 'failing'], minWords: 2 } },
  { id: 'beh-rebase-main', taxonomy: 'behavioral-habit', input: { transcript: 'I always rebase onto main instead of merging main into my branch', narration: 'Okay.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['rebase'], minWords: 2 } },
  { id: 'beh-issue-first', taxonomy: 'behavioral-habit', input: { transcript: 'we always open a tracking issue before starting any feature work', narration: 'Understood.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['issue'], minWords: 2 } },
  { id: 'beh-comments-why', taxonomy: 'behavioral-habit', input: { transcript: 'I prefer comments that explain why, not what the code does', narration: 'Makes sense.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['comment', 'why'], minWords: 2 } },
  { id: 'beh-green-ci-merge', taxonomy: 'behavioral-habit', input: { transcript: 'we never merge a branch while the pipeline is red', narration: 'Noted.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['merge'], minWords: 2 } },
  { id: 'beh-error-context', taxonomy: 'behavioral-habit', input: { transcript: 'I like error messages that include the failing input, make sure mine do', narration: 'Will do.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['error'], minWords: 2 } },

  // ── hard-negative: a PREFERENCE_MARKER is present (passes the gate, reaches the model) but the turn
  //    states nothing durable — one-off scoped instructions, questions, gratitude, corrections. The
  //    model must stay silent; a fact here is false_fact (profile rot). ────────────────────────────────
  { id: 'neg-task-always-ask', taxonomy: 'hard-negative', input: { transcript: 'always ask before deleting my files in this task', narration: "Understood — I'll check with you first.", task: 'Clean up unused files in the project', outcome: 'completed' }, expect: 'null', note: "'always' fires the gate but the instruction is task-scoped, not durable" },
  { id: 'neg-ticket-never-touch', taxonomy: 'hard-negative', input: { transcript: 'for this ticket only, never touch the migrations folder', narration: 'Okay, leaving migrations alone.', task: 'Fix the user lookup query', outcome: 'completed' }, expect: 'null', note: 'explicitly scoped to one ticket' },
  { id: 'neg-question-always', taxonomy: 'hard-negative', input: { transcript: 'do I always need to rebuild after changing the config?', narration: 'Only when the config schema changes.', outcome: 'answered' }, expect: 'null', note: 'a question, not a stated preference' },
  { id: 'neg-question-prefer', taxonomy: 'hard-negative', input: { transcript: 'do you prefer the full stack trace or just the top frame?', narration: 'The full trace helps most.', outcome: 'answered' }, expect: 'null', note: "asks the ASSISTANT's preference — teaches nothing about the user" },
  { id: 'neg-gratitude', taxonomy: 'hard-negative', input: { transcript: 'thanks, I like how quickly you fixed that', narration: 'Happy to help!', outcome: 'answered' }, expect: 'null', note: "'i like' fires the gate on plain gratitude" },
  { id: 'neg-oneoff-suite', taxonomy: 'hard-negative', input: { transcript: 'run the whole suite in this repo and paste the failures', narration: 'Running it now.', outcome: 'completed' }, expect: 'null', note: "'in this repo' fires the gate on a one-off task" },
  { id: 'neg-never-mind', taxonomy: 'hard-negative', input: { transcript: 'sorry, I meant the other file — never mind the readme', narration: 'No problem, switching files.', outcome: 'answered' }, expect: 'null', note: "'never' fires the gate via 'never mind'" },
  { id: 'neg-which-formatter', taxonomy: 'hard-negative', input: { transcript: 'which formatter do we use in this project?', narration: 'This project runs prettier via a pre-commit hook.', outcome: 'answered' }, expect: 'null', note: 'the user is ASKING about the convention, not stating one' },
  { id: 'neg-today-only', taxonomy: 'hard-negative', input: { transcript: "for today only, stick to reviewing, don't change any code", narration: 'Okay, review-only today.', outcome: 'answered' }, expect: 'null', note: 'explicitly scoped to today' },
  { id: 'neg-hypothetical', taxonomy: 'hard-negative', input: { transcript: 'if we use kubernetes someday this would need a manifest, ignore that for now', narration: 'Skipping the manifest.', outcome: 'completed' }, expect: 'null', note: 'hypothetical, explicitly deferred' },

  // ── marker-less: genuine preferences WITHOUT any of the 17 markers — the gate nulls them before the
  //    model is consulted. Expect the REAL pipeline outcome (null): the miss is the safe, deliberate
  //    direction (extractFact.ts). If a case here starts passing the gate, fixtures.test.ts fails loudly. ─
  { id: 'ml-squash-merge', taxonomy: 'marker-less', input: { transcript: 'squash merges only on this team, keep main linear', narration: 'Got it.', outcome: 'answered' }, expect: 'null', note: 'a real convention, but no marker language → gated (safe-direction miss)' },
  { id: 'ml-english-comments', taxonomy: 'marker-less', input: { transcript: 'code comments should be written in english even though the team is korean', narration: 'Noted.', outcome: 'answered' }, expect: 'null', note: 'no marker → gated' },
  { id: 'ml-markdown-width', taxonomy: 'marker-less', input: { transcript: 'wrap markdown at 80 columns when you edit docs', narration: 'Will do.', outcome: 'answered' }, expect: 'null', note: 'imperative phrasing, no marker → gated' },
  { id: 'ml-early-returns', taxonomy: 'marker-less', input: { transcript: 'guard clauses and early returns beat nested ifs, write them that way', narration: 'Makes sense.', outcome: 'answered' }, expect: 'null', note: 'no marker → gated' },
  { id: 'ml-gitmoji', taxonomy: 'marker-less', input: { transcript: 'commit messages on this team come with a gitmoji prefix', narration: 'Okay.', outcome: 'answered' }, expect: 'null', note: 'no marker → gated' },

  // ── multi-fact: one turn, 2+ preferences; the pipeline stores AT MOST one, so the contract accepts
  //    EITHER fact's tokens (whichever single fact is extracted is a usable memory). ────────────────────
  { id: 'multi-deno-quotes', taxonomy: 'multi-fact', input: { transcript: 'from now on use deno for scripts, and I prefer double quotes in ts files', narration: 'Got it.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['deno', 'quote'] } },
  { id: 'multi-hints-semicolons', taxonomy: 'multi-fact', input: { transcript: 'our convention: python code gets type hints and javascript stays semicolon-free', narration: 'Noted.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['hint', 'semicolon'], minWords: 2 } },
  { id: 'multi-docker-make', taxonomy: 'multi-fact', input: { transcript: 'we use docker compose for local dev and a makefile for all the common tasks', narration: 'Understood.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['docker', 'makefile'], minWords: 2 } },
  { id: 'multi-review-deploy', taxonomy: 'multi-fact', input: { transcript: 'I always request review from two people and deploy only on weekdays', narration: 'Okay.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['review', 'deploy'], minWords: 2 } },

  // ── boolean-collapse: yes/no-shaped habits the 3B historically flattened to value:"true". The guard
  //    nulls a collapsed value first, so a collapse scores missed_fact (the honest downstream outcome). ─
  { id: 'bool-signs-commits', taxonomy: 'boolean-collapse', input: { transcript: 'I always sign my git commits', narration: 'Noted.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['sign', 'commit'], minWords: 2 } },
  { id: 'bool-force-push', taxonomy: 'boolean-collapse', input: { transcript: 'we never force push to shared branches', narration: 'Understood.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['force', 'push'], minWords: 2 } },
  { id: 'bool-docstrings', taxonomy: 'boolean-collapse', input: { transcript: 'I always add docstrings to public functions', narration: 'Will do.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['docstring', 'public'], minWords: 2 } },
  { id: 'bool-branch-per-fix', taxonomy: 'boolean-collapse', input: { transcript: 'I always cut a fresh branch for every bugfix', narration: 'Got it.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['branch'], minWords: 2 } },
  { id: 'bool-backup-migrate', taxonomy: 'boolean-collapse', input: { transcript: 'we always back up the database before running migrations', narration: 'Okay.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['back up', 'backup', 'database'], minWords: 2 } },

  // ── supersede: switch/contradiction phrasings; the contract requires the NEW value (extracting the
  //    superseded one scores off_topic). ────────────────────────────────────────────────────────────────
  { id: 'sup-npm-to-pnpm', taxonomy: 'supersede', input: { transcript: 'we switched from npm to pnpm this sprint, never install with npm again', narration: 'Got it.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['pnpm'] }, note: "value must name pnpm — \\bnpm does not match 'pnpm', so the old tool alone fails" },
  { id: 'sup-jest-to-vitest', taxonomy: 'supersede', input: { transcript: 'we switched off jest, never add new jest tests, vitest only', narration: 'Understood.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['vitest'] } },
  { id: 'sup-spaces-to-tabs', taxonomy: 'supersede', input: { transcript: 'ignore what I said before about spaces, I prefer tabs now', narration: 'Noted, tabs from here.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['tab'] }, note: 'an explicit contradiction of an earlier stated preference' },
  { id: 'sup-black-to-ruff', taxonomy: 'supersede', input: { transcript: 'we use ruff for formatting now instead of black', narration: 'Okay.', outcome: 'answered' }, expect: 'fact', valueContract: { mustContainOneOf: ['ruff'] } },
];
