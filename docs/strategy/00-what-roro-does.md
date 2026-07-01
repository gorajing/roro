# What roro actually does

*The whole strategy, collapsed to the concrete product. Plain terms.*

**roro is a small pixel-cat that lives on your screen and helps you with whatever's in front of you — entirely on your machine.**

It does six things:

1. **It lives on your glass.** A little cat in the corner — transparent, always on top, out of the way, draggable anywhere. Not a window you open or a tab you switch to. It's just *there*, like a real pet on your desk. *(Real today.)*

2. **You point at things and it points back.** Drop the cat on something on your screen — a line of code, a diff, a confusing button, a settings toggle — and say "this: what's wrong / what is this / how do I do this." It trots a paw to the exact pixel that matters and answers *on the thing itself*, no tab-switch. Point to ask, point to answer. *(The wedge — near-term build.)*

3. **It builds things for you.** Ask it to make or fix something in your project. It plans, runs a coding agent **locally**, edits the files, and shows you the whole time (`thinking… → working… → done · 2 files`). It drafts and points; *you* apply and commit. It never reaches into your apps on its own. *(Real today.)*

4. **It remembers how you work.** Privately, on your machine, it builds a picture of your codebase, recurring bugs, decisions and *why*, your style. It hands you your thread on return ("you were mid-refactor, tests red on currency rounding"), and the *second* time you hit the same wall it points at how you solved it last time, before you ask. *(The spine — the build ahead; the moat.)*

5. **It stays out of your way.** Silent by default. Never nags, notifies, guilts, streaks, or asks to be "fed." It reacts to you (looks where you point, perks up at a green build) but asks nothing, ever. Its moods reflect your real work, with a valence floor — never sad *at* you. *(Partly real.)*

6. **It never phones home.** The brain is local (Ollama). Nothing leaves. You can open, edit, or delete everything it remembers; you can watch the network counter sit at zero. That's why you can point it at your real work and trust it. *(Real today.)*

## A day with it
You sit down, roro's asleep in the corner; you open your editor and it wakes. You're staring at a failing test — you grab the cat, drop it on the red line, say *"why's this failing?"*; it walks over, rests a paw on the assertion, tells you in a sentence. You fix it. Later you type *"add a rate limiter to the login route"*; it thinks, works ~30s, edits two files, shows the diff, nods `done · 2 files`; you review and commit. You get pulled into a meeting. An hour later you come back and roro says *"you were adding the rate limiter — middleware's in, the test isn't written yet."* You never opened a chat window, nothing left your laptop, and it never once interrupted you.

## The honest split
- **Real, running today:** the floating transparent pet; drag-anywhere; ask-it-to-build → plan/run-agent/edit-files with live `thinking→working→done`; local brain; encrypted local memory; restraint (no nagging).
- **The near-term build — what makes it *roro*:** #2, the **drop-the-cat-on-a-thing, point-back answer** (the "cat walks to the bug" wedge; ~80% built from parts it already has).
- **The build ahead — the moat:** #4, the **deep private memory** that hands back your thread and recalls how *you* solved something.

## The casual angle, in one line
The pointing (#2) works for anyone on any app — that's the universal on-ramp — but the remembering (#4) earns them long-term, and only in tools they live in daily. See `03-casual-users.md`.
