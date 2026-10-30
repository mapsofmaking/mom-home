# Manual test suite

**A kit version is not validated until this has been run against a live
provider.** The automated checks (`npm run verify`) cover the logic and the
design tokens. They do not cover sign-in, and must never be read as if they did:
OIDC needs a browser, a real provider and real credentials, so it is verified by
hand or not at all.

Run this after `npm run dev`, on your own machine, before adopting a kit version
for a new app.

---

## Run record

Copy this block into the repo (or the app's own README) when you complete a run.
A finished run is what backs the claim that the kit works.

```
kit version : 0.1.0
provider    : https://pod.nicolasdb.eu/
browser     : 
date        : 
result      : 
```

A step that fails is a finding to write down, not something to retry until it
passes quietly. "The provider did not prompt for consent" is useful; a blank is
not.

---

## Before you start

```bash
npm install
npm run verify     # typecheck + tests + design audit — all must pass
npm run dev
```

If `npm run verify` fails, stop. There is no point testing sign-in against a kit
that does not pass its own checks.

---

## 1 · The app loads

**Do:** open the dev server URL.

**Expect:** the sign-in screen, styled — heading, explanatory line, a labelled
field prefilled with `DEFAULT_IDENTIFIER`, one primary button. No unstyled flash
before the CSS lands.

**Observed:**

---

## 2 · Sign in with a pod address

**Do:** leave the prefilled issuer URL (`https://pod.nicolasdb.eu/`) and submit.

**Expect:** the button shows "Redirecting…", then the provider's own login page
appears. Sign in, consent. You land back on the app, which shows your WebID and
the discovered pod root.

This exercises `isOidcIssuer` — the `.well-known/openid-configuration` probe
succeeds and the address is used as the issuer directly, with no profile read.

**Observed:**

---

## 3 · Sign in with a WebID

**Do:** sign out. Enter your WebID (`…/profile/card#me`) and submit.

**Expect:** the same end state, reached differently — an identifier containing
`#` skips the probe entirely and goes to `discoverOidcIssuer`, which reads the
profile document for `solid:oidcIssuer`.

Both paths must work. This is the one that breaks when a profile is served
without the right content type.

**Observed:**

---

## 4 · The session survives a reload

**Do:** while signed in, reload the page.

**Expect:** still signed in, no redirect. `restorePreviousSession` did its job.

**Observed:**

---

## 5 · Session ids do not collide

**Do:** serve a second copy of the kit on a different port with a *different*
`SESSION_ID` in `src/config.ts`. Sign in to both.

**Expect:** both stay signed in independently.

Then set them to the *same* `SESSION_ID` and repeat.

**Expect:** they interfere — this is the failure that forced valisette and the
backoffice onto separate subdomains, and reproducing it once is worth more than
reading the comment about it. Set the ids back to distinct values afterwards.

**Observed:**

---

## 6 · Pod discovery without `pim:storage`

**Do:** sign in with a WebID whose profile has no `pim:storage` triple (an older
pod, or one edited to remove it).

**Expect:** the pod root is still found, via the Link-header walk — **and it is
the user's pod, not the server root.** On a multi-pod server the root advertises
`pim:Storage` too, so a walk that does not stop at the first match silently
returns something unwritable.

**Observed:**

---

## 7 · An expired session reports itself

**Do:** sign in, then invalidate the session (revoke the app in the provider's
UI, or leave it until the token expires) and trigger a pod read.

**Expect:** "the session has expired…" naming the resource — not a raw 401, and
not the server's error graph.

On a private pod an expired token makes *everything* answer 401, existence
probes included, so this is the message that decides whether the next failure is
diagnosable.

**Observed:**

---

## 8 · An unreachable provider says so

**Do:** enter an address that does not resolve, or disconnect and submit.

**Expect:** a message naming the address and suggesting what to check — not
"Failed to fetch".

**Observed:**

---

## 9 · The design system, all three themes

**Do:** in a fresh private window with the OS set to dark, open the app. Then
open `/styleguide.html` and use the Light / Dark / High contrast preview.
Back in the app, press the theme button: Dark, then Same as this device.
Reload on Dark. With Same as this device chosen, switch the OS between light
and dark without reloading. Finally turn on the OS "increase contrast" setting.

**Expect:** the app opens **light** despite the dark OS, with no flash of
dark. Every contrast badge reads AA (AAA in High contrast). Nothing unreadable
in any theme — particularly no token that renders one theme's text on another
theme's ground, which is what a slot defined in only one mode looks like. The
button's label follows each press ("Theme: same as this device. Change it").
The reload stays dark with no flash of light. Same as this device follows the
OS live, both ways, and gives High contrast once contrast is increased. The
display serif and Commit Mono load (titles in Newsreader, never bold).

**Observed:**

---

## 10 · Mobile layout

**Do:** open the app on a real phone with a notch — a simulator will not do,
because `env(safe-area-inset-*)` resolves to zero in most of them.

**Expect:** content clears the notch and the gesture bar. Rotate, and scroll to
the bottom: nothing sits under a browser bar, because the layout uses `dvh`
rather than `vh`.

**Observed:**

---

## Identity pages of a CSS instance

For an instance running the `solid-css-overlay` image, after its deploy, on the
live server. That repo's local smoke run (`test/`) covers sign-up, pods, a test client's consent,
themes and 360 px; these are what it cannot reach.

**Do:** sign in to a real app (Valisette, the backoffice) from a fresh browser,
through the instance. On consent, choose a WebID other than the first and
authorize. Sign out of the app, sign in again.

**Expect:** consent names the app as the app calls itself, lists the account's
WebIDs grouped by pod with the pod and document readable at a glance, and the
second time pre-selects the WebID chosen the first time. Nothing on the page
is in a different font or colour from the rest.

**Observed:**

**Do:** leave an app signed in, delete or recreate the account it used (or
clear only the app's storage), and return to the app.

**Expect:** "Getting you signed back in", then the app, signed out and
legible. If the repair fails, "Your sign-in for this app is out of date" with
a button that works, and the technical detail folded away.

**Observed:**

**Do:** on a phone, choose Dark in the footer of any identity page, then open
the welcome page and a public `.md` link on the same instance.

**Expect:** all three dark, no light flash on load; the choice does not carry
to another domain (it is per origin).

**Observed:**

---

## 11 · Device feedback, if the app wires it

Skip if the app has no sound / haptics / screen-wake toggles. None of this is
machine-checkable, and all of it fails silently.

**Do:** on a real Android phone and a real iPhone, turn each toggle on *before*
starting anything, then run the app's main flow, then background the tab for a
minute and come back.

**Expect:** the toggle takes effect on tap, not at the next action — a toggle
that shows itself as on while holding nothing is the bug
[`docs/device-feedback.md`](https://github.com/nicolasdb/solid-kit/blob/f880797/docs/device-feedback.md) exists to prevent. Sound plays
from the first event (the `AudioContext` was armed by a gesture). The haptics
toggle is absent on iPhone rather than present and inert. The screen holds while
the toggle is on and dims normally once it is off, and the app says which path
is holding it. Coming back from the background: the screen lock is re-acquired,
the elapsed time is right rather than short, and a burst of queued signals does
not fire at once.

**Observed:**

---

## UX review

Not machine-checkable. Answer these per release, about whatever screens the app
has grown — the kit's own shell is small enough that most only become real once
an app is built on it.

- Does every step present **at most four** things to hold at once?
- Does every screen have exactly **one** primary action, visually distinct?
- Is the friendly view the default, with the technical one available on demand
  rather than always shown?
- Is progress through anything multi-step **visible**, and grouped into a few
  phases rather than counted in steps?
- Does every mutating action offer an **undo**?
- Does the closing screen **restate the model** rather than just confirming?
- Is any state indicated by **color alone**?
- Does the copy name things as a person would recognize them — a pod, a name on
  the web, who can see what — rather than as the system is built?

Error states carry their own questions, because `renderError` can enforce that
there *is* a way forward but not that the way forward is any good:

- Does every error say **what happened**, **which resource refused**, and **what
  to do next** — and is the "what to do next" something the person can actually
  do from where they are standing?
- Does the copy avoid implying the failure was **their mistake**? An expired
  token, a provider down and a moved pod are all the system's doing.
- Does it say what happened to **their work**? "Nothing was lost" is the
  sentence people are actually looking for, and it must be true when written.
- Is the raw failure available on demand and **not** on the screen by default?

And two from the laws the kit follows without a machine check
([`ux-principles.md`](ux-principles.md)):

- Can someone who **skipped every explanation** still use the app? The paradox
  of the active user says most people will, whatever the onboarding does.
- Does the sign-in field accept the address in whatever shape the person has it
  — WebID, pod URL, with or without a trailing slash?

See [`ux-principles.md`](ux-principles.md) for where these come from.
