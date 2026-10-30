# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## What this repo is

**mom-home**, the Maps of Making home app at `home.mapsofmaking.org`: one app,
two modes. Signed out, it onboards a makerspace (describe it, publish it);
signed in through the space's pod, the same page is the workbench, a hex view
of what the coordinator can do next. Planned as Epic 14 in
[maps_of_making](https://github.com/mapsofmaking/maps_of_making) (stories in
`_bmad-output/implementation-artifacts/14-*.md`, the hex placement rules in
`docs/explanation/home-hex-view.md`).

- **The tree is data.** `public/onboarding.ttl` holds every tile, requirement,
  cue, word and line Bernard speaks. It is the single source of the app's copy:
  another vertical forks the app by swapping that file.
- **The pod is the map.** A tile's state is read from the space's pod, never
  stored as progress.
- **Copied from solid-kit at `f880797`** (kit ADR 004: copied, not packaged).
  Every divergence from the kit is a diff against that commit. The ecosystem
  map is the kit's [atlas](https://github.com/nicolasdb/solid-kit/blob/f880797/docs/atlas.md); the kit's ADRs are
  cited below by number and live there.
- **Same-site with the pod server** (`pod.mapsofmaking.org`): account features
  only work because both share `mapsofmaking.org` (kit ADR 010, amended).
- **The map's API is on this host.** The gateway sends `/api/` to the map's
  container, so the page calls geocode, register and heartbeat same-origin.

## Commands

```bash
npm install
npm run dev      # app at /, /styleguide.html, /guidelines.html; /api → the map dev stack on :8080
npm run verify   # typecheck + tests + audit; the gate before adopting a version
npm test         # vitest
npm run audit    # contrast, token completeness, a11y affordances
npm run build    # tsc && vite build (three entries: index, styleguide, guidelines)
make             # lists the targets
```

### Verification has three layers, and they do not overlap

1. **`npm run verify`** — automated. Tests cover the logic carrying a "this
   broke before" comment; the audit enforces the contrast and token-completeness
   rules that would otherwise be comments nobody re-checks.
2. **`/styleguide.html`** and **`/guidelines.html`** — the design system read
   back from its own live CSS, and the UX patterns rendered by the same
   functions an app calls. Never hardcode a value into either; a reference page
   that restates what it documents cannot catch drift, which is its only job.
3. **`docs/manual-tests.md`** — sign-in and the mobile layout, run by hand
   against a live provider. **Not covered by 1 or 2, and never claim otherwise.**
   A kit version is not validated until that suite has been run.

When adding to `src/lib/` or `src/ui/`, add the test with it — kit code is
copied, so a bug here is found three times instead of once. Tests are mocked at
`./auth`, so they need no pod.

### Setting a UX preference

Three tiers; use the strongest that fits. A constant in `src/ui/ux.ts` (checked
by the audit), a component in `src/ui/patterns.ts` (enforced by use), or a
review question in `docs/manual-tests.md` (judgment). Never work around a
constant inside a component — that is how the tiers stop meaning anything.

A component that enforces a limit **throws** rather than truncating. Silently
dropping authored copy loses work nobody notices; throwing surfaces the decision
while the copy can still be reconsidered.

## Architecture

No framework, no router. Screens are functions replacing the contents of
`#app`. Three apps converged on this independently at this size; don't
introduce a component system without a reason bigger than taste.

Two consequences of this shape, both found the hard way and easy to reintroduce:

**A re-render destroys whatever the screen it replaces was holding onto** — a
running timer and its `setInterval`, an unsaved but un-drafted keystroke, an
open `<details>`. There is no diffing to preserve it. A global setting that
must apply everywhere (theme is the easy case) is safe to flip from any screen.
One that forces a *full* re-render to take effect — because it changes strings
baked into markup across every screen, say — is not: firing it from a screen
that holds volatile state silently discards that state. Put that kind of
toggle on a screen that already re-renders wholesale on its own (a settings or
picker screen), not on a persistent bar layered over a screen with something
running.

**Class names are the only namespacing there is, so an identically-named class
used for two different things on two different screens collides silently.**
A card reusing a list's `.is-current` for "this one is the default choice"
will also inherit whatever `.is-current` means on the screen that class was
written for — a size bump, an animation, a color — with no error, just a
render that looks wrong for a reason that isn't where you'd look. Screen- or
feature-specific effect classes (a highlight, a live-updating indicator) want
a name that says what screen they belong to, not just what state they mark;
generic state words (`is-active`, `is-selected`) are fine only when every
screen that uses them means the same visual thing by them.

- `src/config.ts` — everything an app changes. `SESSION_ID` **must be unique
  per app**: two apps on one origin sharing an id clobber each other's tokens,
  which is the bug that forced valisette and the backoffice onto separate
  subdomains.
- `src/lib/auth.ts` — login with no hardcoded provider; accepts an issuer URL
  or a WebID (`#` means WebID, no probe). Owns the `Session`, and exports
  `authFetch` as a *delegating* wrapper — capturing `session.fetch` at module
  load would keep sending unauthenticated requests after login.
  `completeLogin` never throws; it reports `offline` when session state is
  unknown.
- `src/lib/pod.ts` — pod-root discovery and error classification. Deliberately
  domain-free; apps use `@inrupt/solid-client` directly with `authFetch`. There
  is no generic read/write wrapper because no two apps wanted the same one.
- `src/lib/conditional.ts` — for documents something *else* also writes. If the
  app is the only writer, plain solid-client calls are simpler and enough.
- `src/lib/read.ts` — `readTurtle` for what a screen *shows*: revalidates with
  `If-None-Match`, 304 hands back the copy kept in memory; `forgetReads()` at
  sign-out. Not a generic wrapper: writes never use it. Why, and the two
  other rules for fast screens: [ADR 007](https://github.com/nicolasdb/solid-kit/blob/f880797/docs/adr/007-reads-revalidate-never-trust-a-copy.md).
- `src/lib/draft.ts` — `makeDraftStore<T>`, for the window where the browser
  holds the only copy of the user's work.
- `src/lib/literal.ts` — `readLiteral`, for a value that may or may not carry a
  language tag. `getStringNoLocale` returns **null** on a tagged literal, which
  is invisible right up until something starts tagging — a new writer, an
  import tool, a language-aware editor — at which point every value read
  through it goes blank at once, with no error pointing at why. Read for both
  shapes from the start. Order: the app's preferred language first, then the
  untagged form (an app is more likely reading its own untagged writes than a
  real second-choice language), then the rest of the preference list.
- `src/lib/identity.ts` — `shortWebId`, because a WebID truncated by a trailing
  ellipsis loses exactly the part that identifies it: scheme and host repeat
  across every identity at one provider, `/profile/card#me` is the convention
  nearly every server writes, and what actually distinguishes an identity sits
  at the end — the part the ellipsis cuts first. Keep the full WebID in a
  `title` attribute; this is a display shortcut, not a replacement.
- `src/styles/core.css` — structure and the slot contract. Project-agnostic:
  never edit it per app. `src/styles/theme.css` is the file to fork for a
  different look. `src/styles/editorial.css` is the editorial register
  (landings, reading pages, `.hint`), CSS only; `src/styles/fonts.css` the two
  webfonts. All four are held to `design/` (the Solid Kit design system's
  `tokens.json` and `bundle.css`) exactly: change a value there first. Help
  text is `.hint`, never `.meta`; the serif is never bold.
- `src/ui/` — the UX layer. `ux.ts` holds the preferences that are values,
  `patterns.ts` the components that enforce them, `a11y.ts` the focus and
  announcement helpers the shell calls on every render, `theme.ts` the theme
  switch the shell shows on every screen.

### Pod-root discovery

Two tiers, and the order matters: the `pim:storage` triple in the WebID profile
first, then a walk up the URI hierarchy looking for a `Link: <pim:Storage>;
rel="type"` header.

**Stop at the first match when walking up.** A multi-pod server advertises
pim:Storage on its own server root too; continuing past the first hit yields the
server root, which is not the user's pod and is not writable.

**Never derive the pod root by string-parsing the WebID.** It happens to work
for the `/<user>/profile/card` layout and has no basis in the spec — and the
portability path ([ADR 002](https://github.com/nicolasdb/solid-kit/blob/f880797/docs/adr/002-portability-tiers.md)) puts identity and
storage on different hosts by design.

### Auth errors

On a private pod, an expired token makes *everything* answer 401 — existence
probes included. A raw 401 therefore says nothing about whether a resource
exists. Route it through `isAuthError` and report an expired session rather than
surfacing the server's error graph.

### Styling

`core.css` declares slots; `theme.css` fills them. Define the **complete** slot
set in every mode — a token defined for light but not dark renders one theme's
text on the other theme's ground.

Light is the default for everyone, stamped `data-theme="light"` in each HTML
entry. The theme button (`src/ui/theme.ts`) cycles Light → Dark → Same as this
device, and "same as this device" is resolved to dark, contrast or light by
the blocking first-paint script in each entry, which also follows the device
while the page is open ([ADR 008](https://github.com/nicolasdb/solid-kit/blob/f880797/docs/adr/008-light-by-default.md), amended).
Never add a `prefers-color-scheme` block, nor a `prefers-contrast` copy of the
contrast theme — the audit refuses both in `theme.css`; High contrast is
reached only through `prefers-contrast: more`. Not a hardcoded class and not
JS-applied inline styles. Text tokens clear WCAG AA 4.5:1 against the surface
behind them, and AAA 7:1 in the high-contrast theme, whose borders also reach
3:1; `--text-tertiary` is the one that gets this wrong in practice, because it
carries small mono labels — re-check any replacement against both `--surface`
and `--surface-elevated`.

Two layout rules are load-bearing: `100dvh` never `vh` (`vh` ignores retracting
browser bars and pushes bottom controls underneath them), and
`env(safe-area-inset-*)` padding, which silently resolves to zero unless
`index.html` keeps `viewport-fit=cover`.

## Deployment

One image (kit ADR 011): `Dockerfile` builds the static app and serves it from
nginx; CI publishes `ghcr.io/mapsofmaking/mom-home:sha-<commit>` on every push
to `main`, and the server pulls the tag in `HOME_TAG` (`docker-compose.yml`).
Nothing compiles on the server. `/id.jsonld`, the Client ID Document (kit ADR
010 point 6), is written at start from `PUBLIC_URL`
(`deploy/docker-entrypoint.d/40-client-id.sh`).

`deploy/gateway-vhost.conf` is versioned here but must be installed into
`hetzner-gateway/nginx/conf.d/17-home-mapsofmaking.conf` and deployed from
there: that repo stays the source of truth for routing. It sends `/` here and
`/api/` to the map.

## CSS instances

The identity-page overlay, its method and its smoke run moved to
[`solid-css-overlay`](https://github.com/nicolasdb/solid-css-overlay), which
ships them as an image ([ADR 009](https://github.com/nicolasdb/solid-kit/blob/f880797/docs/adr/009-css-instance-is-a-skin-over-stock.md),
amended). What stays here is the skin audit, beside the slots it checks:
`npm run audit -- --skin <skin.css>`.

## Device feedback on mobile

Sound, haptics and "keep the screen on" are not in the kit as code — they are
only worth wiring in an app that needs them. The platform constraints that cost
a debugging session each are written down in
[`docs/device-feedback.md`](https://github.com/nicolasdb/solid-kit/blob/f880797/docs/device-feedback.md): `AudioContext` starts
suspended until a user gesture, `navigator.vibrate` does not exist on iOS
Safari, the wake lock is released on every page hide, and a muted looping video
is a second door to the same OS sleep inhibition rather than a stronger one.
Read it before writing any of the three.

## Out of scope, on purpose

No demo-mode framework ([ADR 005](https://github.com/nicolasdb/solid-kit/blob/f880797/docs/adr/005-demo-mode-is-per-app.md)), no
ACL/permission helpers (the backoffice's job — see
[ADR 003](https://github.com/nicolasdb/solid-kit/blob/f880797/docs/adr/003-acl-writes-are-hand-written-turtle.md)), no data-format
helpers (TOML and Turtle are both legitimate per-app choices), no vocabulary.
Adding any of these is a decision that needs an ADR, not a commit.
