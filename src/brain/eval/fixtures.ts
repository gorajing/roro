// src/brain/eval/fixtures.ts — the GOLDEN turn set the brain eval scores against.
//
// Hand-curated to be defensible against the SYSTEM_PROMPT contract (src/brain/index.ts): run_agent is the
// default for any coding/file/test/build task; answer is talk-only; capture_screen is ONLY for things
// visible on screen but not in the codebase; clarify is for genuinely ambiguous requests with no referent.
// Keep expectations UNAMBIGUOUS — the eval measures the model, so a wrong golden answer poisons the metric.
// Seed/grow this from real RORO_TRACE captures over time (the roadmap's M1 note).

import type { Command, DecideInput } from '../../shared/brain';
import type { FactExtractInput } from '../extractFact';

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
