# UX principles

The interaction rules these apps are built to. Extracted from the backoffice,
which worked them out first and in the most detail.

The through-line: people using these apps are being asked to hold an unfamiliar
mental model (a pod, a WebID, access rules) while doing something ordinary. Every
rule below buys back attention for the ordinary thing.

## The principles

Cognitive ergonomics, via the Laws of UX:

- **Miller's law — at most four chunks per step.** A concept screen carries two
  or three ideas, never a list of nine.
- **Hick's law — one primary action.** Where a screen offers a choice, it offers
  two options and makes one visually primary.
- **Progressive disclosure.** The friendly view by default, the raw one on
  demand: plain-language sharing first, the actual WAC rules behind "show the
  technical rules".
- **Zeigarnik and goal-gradient — visible progress.** Ten chapters shown as
  three phases, because three is legible and ten is a wall.
- **Peak-end — a recap finale.** The last screen restates the mental model
  rather than just confirming success.
- **Reversibility everywhere.** Every mutating action carries an undo. "Always
  reversible" is stated to the user as a property of the system, not discovered
  per action.
- **Graceful failure, not just graceful success.** The quality of the error
  states decides long-term trust more than the quality of the success states.
  A success path is forgotten the moment it works; a dead end is remembered.
  Every error state acknowledges what happened, names the resource that refused,
  and offers a way forward — an action, or a sentence saying why there is none.
  This matters more here than in most apps because pod failures are *routine*
  rather than exceptional (expired token, provider down, pod moved) and none of
  them are the user's mistake. `renderError` throws rather than render an error
  with no way forward.

- **Doherty threshold — 400ms, both directions.** Above it, a wait must be
  acknowledged; below it, acknowledging it is a flicker that reads as a glitch.
  `mountPending` shows nothing for the first 400ms and stops repeating itself
  after ten seconds — an indicator that loops unchanged forever tells a person
  nothing they cannot already see.

Accessibility is not a setting: WCAG 2.1 AA throughout (4.5:1 contrast,
`focus-visible`, never color alone as an indicator), and where a more legible
typeface is offered, **it is the default** rather than an option to find.

### Three laws that are already in the code, and worth naming

Checked against [lawsofux.com](https://lawsofux.com/). These were being followed
before they had names, which is the good case — but an unnamed rule is one the
next person deletes as an inconsistency.

- **Tesler's law — irreducible complexity has to sit somewhere.** Identity being
  separate from storage is not accidental complexity that better design removes;
  it is the point of Solid, and the portability path
  ([ADR 002](https://github.com/nicolasdb/solid-kit/blob/f880797/docs/adr/002-portability-tiers.md)) depends on it. So the question is
  never "how do we make this simple" but "who absorbs it" — and the answer is
  the app. Two-tier pod discovery exists so a person never has to know where
  their storage is advertised. This is the law that says where *not* to
  simplify.
- **Postel's law — liberal in what the sign-in field accepts.** `auth.ts` takes
  an issuer URL *or* a WebID and decides which by looking for a `#`; `slugify`
  folds accents rather than dropping them. A person who has one string that
  identifies them should not have to know which kind it is.
- **Jakob's law — sign-in looks like sign-in.** Pod addresses are the unfamiliar
  part of this and they are unavoidable. Everything around them — a field, a
  label, one primary button — stays the shape people already know. Novelty spent
  on the frame is novelty unavailable for the one genuinely new idea.

### One tension to hold, not resolve

**Paradox of the active user.** People do not read the explanation; they start
using the thing. That is in direct tension with concept cards and comprehension
checkpoints, and the resolution is not to drop them — a pod is genuinely
unfamiliar and someone will want the model. It is that onboarding must be
**skippable**, and the app must be usable by someone who skipped it. An
explanation that blocks the door gets clicked through rather than read, which
buys nothing and costs the good will of everyone who already understood.

## Two patterns worth reusing

**The comprehension checkpoint.** Mid-onboarding, a phase boundary is a
three-option question about what was just explained — not a counter that advances
regardless. It converts "did they scroll past it" into "did they get it", and it
is the cheapest honest signal available.

**Concept screens as pure data.** Chapters are an array of
`{ icon, title, body }` chunks rendered by one card component, with self-numbering
kickers ("Idea 2 of 3 · Who you are"). Copy stays metaphor-driven and free of
jargon — a pod is a locker, a WebID is your name on the web, sharing is handing
out copies of the key. Keeping them as data is what stops the copy from drifting
into the markup where nobody edits it.

## A note on the source

These were extracted from `pocpod0/backoffice`. Its `HANDOFF.md` is **stale
where it disagrees with the code** — it still describes ACLs going through
`universalAccess` (see [ADR 003](https://github.com/nicolasdb/solid-kit/blob/f880797/docs/adr/003-acl-writes-are-hand-written-turtle.md))
and account creation as simulated, when both had been replaced. Read the code
first when the two conflict.
