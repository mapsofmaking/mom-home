# Decisions

Dated decisions that shape home. Newest first. Each says what was decided, who decided it, and why. The work
itself is tracked in issues and on the `mapsofmaking` org project; older story files (Epic 14, stories 14.0 to
14.4) live in `maps_of_making/_bmad-output/implementation-artifacts/` as frozen references.

Kit-level decisions (Solid, ACLs, sign-in) are ADRs in the kit repo; this file only records home's own.

## 2026-11-03

- **No planned first fold, and no line teaching it** (Nicolas, after the live pass of 14.6 S3, #38; supersedes
  14.1 AC7's "first fold after tile C's tutorial"). Folding as the map caught up changed two things at once:
  the layout moved while the coordinator was looking for the new hours, which is the lesson of C3. The page
  never folds by itself. Fold / Show all is plain enough to be found by curiosity. Unset, a desktop stays
  unfolded and a phone starts folded, as before. Tile C stays side by side unfolded (the 520px step).
- **Tile C changes one statement, never the whole file** (14.6 S1). The space file has other writers (the
  backoffice, later Bernard), so a save is one N3 Patch on the statement the tile owns, sent with the ETag of
  the read just before it; a file changed meanwhile is refused and nothing is written.
- **The map re-reads a changed file through `register-url`** (Nicolas, 14.6). Registering a known address
  again re-reads it in place. The map's per-space refresh, with its cooldown, and how home may reach it, is
  decided with the operator-endpoint work in 14.9; home switches then.
- **14.6 order** (Nicolas): S1 hours, S2 the map's read and the card, S3 the first fold, then S6 logo upload,
  then S5 a space that moves; pause, then decide on S4 (the tool).
- **The `/profile/` rule, narrowed** (Nicolas, devil's-advocated). Home never rewrites the WebID profile.
  When the Type Index links are missing, it may **add** them in one insert-only N3 Patch, and nothing else:
  the server appends, nothing can be deleted or rewritten. By the Solid convention those are
  `solid:publicTypeIndex` and `pim:preferencesFile` in the profile, the private index being named
  (`solid:privateTypeIndex`) in the private preferences file, which home may create, or add that one link to,
  insert-only (amended after the review of #29: the original wording named `solid:privateTypeIndex` in the
  profile, which would publish the private index's address). An unreadable profile is refused, never patched. Changing or removing a profile line is the owner's own act, in the backoffice.
  Our pod server creates both indexes and their links when it makes a pod (solid-css-overlay template), so
  on our pods home never needs to; the patch covers pods hosted elsewhere. Home adds and updates only its
  own entries inside the index files (conditional writes); it opens the public index only when it made it, and
  never widens one that was there. `space.ttl` at the pod root stays the fallback.
  Why: discovery by type is how other apps, agents and later networks find a space (several per person);
  the original rule was about not putting the space in the profile, which still holds.
- **Planning lives in issues and the org project, not in story files** (Nicolas). One issue per slice, written as
  outcome + constraints + live check. Risky slices (accounts, passphrase, ACL, anything that writes to a pod)
  carry the `review` label and get an adversarial review on their PR; every story ends with one full review over
  its diff. A slice's test goes one click past the change.
- **Read the space from the pod on sign-in comes before S2** (#11, Nicolas). Signing out and in, or reloading,
  must not start from scratch.
- **Signed in, "Show me my card" draws the card from the draft and opens tile B** (#8, #9, Nicolas). Nothing is
  marked done: done is read from the pod (#11, #14). The in-tab state is temporary and goes with #11.
- **The publish panel shows no step list before the press** (#10, Nicolas): an empty marker read as a checkbox.
- **Safari/iOS check is open to contributors** (#17); 14.3 is done without it.
- **Deploy after merge** (Nicolas): once a PR is merged and CI is green, the image is deployed without asking again.

## 2026-11-03 (14.4)

- **Other apps find the space through the Type Index** (`solid:forClass mom:Space`), never a link in the WebID
  document: `/profile/` is never written.
- **The draft is cleared from the browser** once the file is written and read back; "Start over" then reads the pod.
- **The closing line says "stuff happens"** ("hours change, stuff happens: when something's different, update it once").

## 2026-11-02 (14.3)

- **A tab that made a pod offers "Sign in to your pod"** before any form that would make a second account
  (option (a)); email recovery stays the safety net. Accounts can't be deleted on CSS 7.2.
- **Live tests run on `pod.mapsofmaking.org` with throwaway accounts.** The instance is wiped before launch.
- **Never probe the account endpoint with POST**: it creates a real, undeletable account.

## 2026-10-31

- **A taken pod name shows after "Create it"**, on the address field, with the passphrase kept: CSS 7.2 can't say
  whether a name is free without creating something. The format is checked live.
- **Bernard warns about the consent page** before "Create it" (`onb:sayConsent`): the pod's own page asks whether
  home may use the pod, and the answer is yes.
- **Home reaches the geocoder on its own origin** (`/api/geocode` through the gateway), so the map's API needs no CORS.

## 2026-10-30

- **The space file is Turtle (`space.ttl`) at the pod root**: the pod is linked-data native, so later tiles read
  and write links without JSON.
- **Registration on the map is automatic**: the coordinator never copies an address (the analytics baseline lost
  almost everyone at that step).
- **The threshold ends by pointing at tile C** ("Update it once →"), not "come back and sign in".
