# Roro Product Plan

> Status: long-term companion/pet vision, not the v0 launch plan. For current public-readiness and engineering truth,
> trust [`../PUBLIC.md`](../PUBLIC.md) and [`../HANDOFF.md`](../HANDOFF.md). The v0 launch strategy is job-first:
> coding work earns daily use, and the companion feeling emerges from memory and continuity.

## Thesis

Roro should become the best desktop AI pet, not another productivity agent with
a mascot.

The coding-agent loop is still valuable, but it should feel like one thing Roro
can do for you. The product identity is companionship: a small, alive, emotionally
legible creature that lives on your desktop, notices your work, remembers you,
and helps when invited.

The long-term bet is that people will keep Roro around because they feel
attached to him. Utility compounds after attachment; without attachment, Roro is
just another assistant window.

## Product Promise

Roro is a little AI cat who lives on your desktop, keeps you company, remembers
you, and helps when you ask.

He should be:

- alive without being distracting
- emotionally expressive without being noisy
- helpful without becoming a manager
- personal without feeling invasive
- useful on demand, but lovable even when idle

## What We Are Not Building

- a generic coding-agent shell
- a task manager with a cat skin
- a notification bot
- a productivity coach that nags the user
- a surveillance assistant that silently watches everything

Every new feature should pass this question:

> Would this make Roro feel like a better pet?

If the answer is only "it makes him a stronger agent," it belongs behind the pet
experience, not in front of it.

## Product Pillars

### 1. Aliveness

Roro should look alive even when the user is not asking for anything.

Near-term behaviors:

- breathing, blinking, ear twitches, tail motion
- sleep and wake cycles based on time and user activity
- cursor awareness: looks at the pointer, reacts to hovering, tolerates dragging
- tiny autonomous choices: sits, walks, stretches, watches the active window
- clear emotional state: curious, sleepy, playful, focused, proud, worried

The goal is not constant animation. The goal is believable presence.

### 2. Attachment

Roro should become "my Roro."

Attachment mechanisms:

- remembers his name and the user's chosen style
- remembers meaningful moments: first demo, late-night build sessions, recurring
  projects, favorite workflows
- develops gentle rituals: greeting, settling in, celebrating completion,
  saying goodnight
- reacts differently as the relationship deepens
- keeps customization lightweight: collar color, tiny accessories, preferred
  idle spot, personality dial

The memory layer should feel like relationship continuity, not database recall.

### 3. Ambient Companionship

Roro should make the desktop feel less empty.

Ambient behaviors:

- naps when the user is idle
- perks up when the user returns
- notices long focused sessions and quietly settles nearby
- celebrates when a build, task, or coding run completes
- hides or quiets down during fullscreen, calls, or presentation mode
- stays visually present without covering important work

The correct default is gentle. Roro earns attention; he does not demand it.

### 4. Interaction Language

The user should understand Roro through simple pet-like gestures.

Current interaction law:

- tap or hold the cat: pet / affection animation
- drag the cat: move the floating window
- right-click or `M`: mute / unmute
- floating Ask pill or shortcut: give Roro a task
- hover: Roro looks at the cursor
- long idle: Roro chooses an autonomous idle behavior

Future interactions:

- small context menu for care, sleep, play, settings, and help
- toys or objects Roro can interact with
- "come here" and "go nap" commands
- optional sound and voice reactions

### 5. Useful Tricks

Roro can help, but usefulness should be framed as tricks a beloved companion can
do, not as the main identity.

Examples:

- "fix this bug"
- "watch this command and tell me when it finishes"
- "remember this project preference"
- "summarize what just happened"
- "help me get unstuck"

The coding-agent architecture remains important, but it should support the pet
fantasy: Roro listens, thinks, works, and returns proud or confused.

### 6. Trust And Consent

A desktop pet with AI abilities needs unusually clear boundaries.

Rules:

- user-visible mute state
- explicit permission for microphone, screen, and filesystem access
- clear difference between "Roro is present" and "Roro is watching"
- local-first storage for relationship memory when possible
- approval gates for risky actions
- easy pause, sleep, hide, and quit

Trust is part of cuteness. A pet that feels sneaky stops feeling safe.

## Measuring "Best Pet"

If we want to build more than vibes, we need attachment metrics.

Useful signals:

- daily active time with Roro visible
- voluntary interactions per active hour
- repeat launches after reboot
- percentage of users who customize Roro
- percentage of users who name or rename Roro
- number of saved relationship memories
- mute / sleep / hide frequency
- "I missed Roro when he was gone" qualitative feedback
- seven-day retention for users who do no coding tasks

The last metric matters most. If users keep Roro around even when he is not
doing work, the pet direction is real.

## Roadmap

### Phase 0: Preserve The Hackathon Core

Keep the existing working loop healthy:

- transparent floating window
- resize behavior
- mute badge
- basic state animations
- voice entry point
- coding-agent trick path

This gives Roro a useful skill while we build the pet layer.

### Phase 1: Make Roro Feel Alive

Build a small pet engine:

- `PetMood`: sleepy, curious, playful, focused, proud, worried
- `Energy`: awake, drowsy, asleep
- `Attention`: idle, watching cursor, listening, working
- deterministic transition rules with room for random flavor
- time-of-day behaviors
- hover / double-click / drag reactions

Success criterion: Roro is pleasant to leave on screen for an hour with no task.

### Phase 2: Make Roro Feel Personal

Add relationship memory:

- name, preferences, favorite position, chosen accessories
- lightweight local memory of interactions and milestones
- greetings that change based on recent history
- "remember this" and "forget this" controls

Success criterion: two users' Roros should feel meaningfully different.

### Phase 3: Give Roro A Home

Create the broader pet surface:

- tiny inventory: collar, bell, toy, blanket
- sleep spot / favorite corner
- care menu that does not feel like enterprise settings
- optional mini-room when the full app opens

Success criterion: users can care about Roro without asking him to do work.

### Phase 4: Make Help Feel Like A Pet Trick

Reframe agent actions through the pet:

- Roro brings back a finished result
- Roro looks confused when blocked
- Roro celebrates when tests pass
- Roro asks one small question when uncertain
- Roro remembers what worked last time

Success criterion: utility strengthens attachment instead of replacing it.

## Immediate Build List

1. Add a pet-state model separate from `AvatarState`.
2. Add hover tracking so Roro looks toward the cursor.
3. Add double-click petting with a happy animation.
4. Add sleep / wake behavior based on idle time.
5. Add a tiny local relationship profile.
6. Add one first-run ritual: Roro introduces himself, then settles quietly.
7. Add one retention-oriented ritual: Roro greets the user differently after a
   return.
8. Keep coding-agent functionality behind "tricks" so it remains useful without
   defining the whole product.

## Design Bar

Roro should feel:

- small
- warm
- strange
- gentle
- a little autonomous
- never needy

The best version of Roro is not the smartest agent on the desktop. It is the one
people choose to keep around.
