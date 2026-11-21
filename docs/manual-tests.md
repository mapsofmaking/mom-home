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

## 12 · Creating a pod from home (Story 14.3), on Safari and iOS

**Deferred (2026-11-02): nobody on the project has macOS or an iPhone.** Chromium and
WebKit (Playwright's Ubuntu image) passed on production, but Playwright's WebKit does not
reproduce Safari's tracking protection, the one thing here that can break. Run this
when someone with a device can, and write the result in the run record.

Why Safari matters: the app logs in through the provider's account API right after the
pod is made, so the provider's `css-account` cookie spares the person its login page
(flow A). Safari may refuse that cookie as a third-party one, though `home.` and `pod.`
share `mapsofmaking.org`. Either result is acceptable, because the app does not depend
on the cookie. The test is that **both ways still end back on home, signed in**.

**Do:** on Safari (macOS) and Safari (iOS), with a private tab, open
`https://home.mapsofmaking.org`, "Fill in an example" (or type a name and a town), "Show me
my card", "Publish it", the pod door. Use a throwaway email you can read and an address
beginning `zz-`. "Create it". Note whether the pod's page asks for the passphrase before
"Authorize". Authorize.

**Expect:**
- The form says "Taken" for `nicolas-test` (nothing was created), and the email field then locks.
- After "Create it" the browser goes to the pod's own page. Either it shows only "Authorize"
  (flow A), or a login page first, with the email and passphrase you just made, then "Authorize"
  (flow B).
- Back on home you are signed in ("Signed in as ..."), tile B says the pod is ready, and
  nothing is written in the pod yet.
- The passphrase is nowhere on the page after "Create it" (not in the fields, not after Back).
- Five creations from one connection in an hour: the sixth says "Press Create it again in about N
  minutes", not "isn't answering".

Throwaway accounts made here are removed by the wipe before launch.

## 13 · Network from tile A (Maakbib)

A network serves an area and has no address (decisions.md, 2026-11-19). Run it on production with a
throwaway pod (`zz-` address), at 1541×751 and on a phone.

**Do:** open `https://home.mapsofmaking.org` signed out. In tile A press "A network". Type the name
"Maakbib (test)", type "Flanders" as the area served and pick "Flanders, Belgium", add a description, the website
`maakbib.be` and the email. "Show me my card", then "Publish it", the pod door, create the pod, sign in,
"Put it on the map". Then open the map from the threshold.

**Expect:**
- The picked kind is plain to see: ink fill and a check mark, in light, dark and high contrast.
- After "A network" the name's label says "Network name", the street and city are gone, and the area
  box is there; "A space" brings street and city back with what was typed in them.
- Typing "Flanders" asks the geocoder once the typing pauses and offers a short list under the box, no
  pop-up and no added scroll at 1541×751; Tab or arrow down reaches it, Enter picks. Picking drops the pin
  at the centre of the area with no second ask; the line under it says the network sits at the centre of
  Flanders. Typing again drops the pick and the pin. "Île-de-France" and "France" are offered too. The pin line names Vlaanderen (not West-Vlaanderen:
  that is the map's bug, fixed there, and home does not work around it).
- The card says "Maakbib (test)" and "Serves Flanders"; with no name yet it says "Your network".
- `space.ttl` in the pod reads `a mom:Network, schema:Organization`, one `schema:areaServed [ a
  schema:AdministrativeArea ; schema:identifier "BE-VLG" ; schema:name "Flanders" ]`,
  the geo and `mom:geolocationFidelity "region"`, and no `schema:address`.
- On the map the network's card says "Serves Flanders", and the threshold says "Anyone looking for a
  workshop in Flanders can find you now."
- Signed out and in again: tile A is done, the form reopens on "A network" with Flanders picked.
- Tile C on a network: hours and logo work; the profile tool shows no address field; no "move" panel.

**Then, the self-host door:** in a fresh private tab, describe the same network, "Show me my card",
"Publish it", "Take the file". The downloaded `maakbib-test.json` has `location` with `country_code`,
`lat` and `lon` and no `address`, and `"mom": {"kind": "network", "areaServed": [{"code": "BE-VLG", "name": "Flanders"}],
"geolocationFidelity": "region"}`.

**Observed:**

---

## 14 · A network welcomes its members (#69)

A network's own tile, "Welcome your members" (hex q0 r1), turns its pod into a Solid collective: `inbox/`,
`config.ttl` (public) and `membres.ttl` (only the owner reads it), and ends on the invitation link. Accepting
and refusing happen in the backoffice. Run on production with throwaway accounts (`zz-` addresses), at
1541×751, with the browser's network tab open.

**(a) A new network, end to end.**

**Do:** signed out, tile A: "A network", name "ZZ Net", area "Flanders", a description. "Publish it", the pod
door, create `zz-net`, sign in, "Put it on the map". Then the welcome tile (it opens first). Check the
description is prefilled from tile A's, type a title, press "Open it to members". Copy the link. In a private
window, open it, sign in to the backoffice as another `zz-` account, "Ask to join". Back in the backoffice
signed in as `zz-net`, accept the request.

**Expect:**
- A space never sees this tile (describe a space in a fresh tab: no hex at q0 r1).
- The form is one Bernard line, two fields, one button; no pop-up, no scroll at 1541×751.
- In the network tab, in this order: `PUT inbox/`, `PUT inbox/.acl`, `PUT membres.ttl`, `PUT membres.ttl.acl`,
  `PUT config.ttl`, `PUT config.ttl.acl`, one `PATCH space.ttl`; every PUT with `If-None-Match: *`, the PATCH
  with `If-Match` and an insert only. Nothing under `/profile/`.
- `config.ttl` reads `<#zz-net> a sc:Collective, foaf:Group`, `foaf:name "ZZ Net"`, the title and description
  under `https://schema.org/`, `sc:roster <membres.ttl>`, `ldp:inbox <inbox/>`, `rdfs:seeAlso <space.ttl#space>`.
  `space.ttl` gained `rdfs:seeAlso <…/config.ttl#zz-net>` and nothing else changed.
- The tile ends on the link `https://backoffice.mapsofmaking.org/?collective=https://zz-net.pod.mapsofmaking.org/config.ttl`,
  Copy puts it on the clipboard, and "Requests to join arrive in the backoffice" opens the backoffice.
- The backoffice shows the invitation with the title and description typed here. Ask to join works; Accept
  works, with **no 404** (the roster is there), and the new member can then read `membres.ttl`.
- Signed out and in again: the tile is done (read from the pod) and shows the link. Pressing nothing writes
  nothing.
- Anonymously (a private window, no sign-in), `config.ttl` reads; `membres.ttl` and `inbox/` answer 401.
- Press again after a run that stopped (cut the network mid-setup): `PUT inbox/` answers 409 on CSS 7.3 and is
  read as "already there"; the run carries on and nothing is written twice.

**(b) Maakbib, made by hand: done, nothing written.**

**Do:** sign in to home as Maakbib's account (its `config.ttl` names `members.ttl`, not `membres.ttl`). Open
the welcome tile.

**Expect:** the tile is done and shows Maakbib's invitation link. The tile's requests are GET and HEAD only
(`config.ttl`, `members.ttl`, `inbox/`): **no PUT and no PATCH** to `config.ttl`, `members.ttl`, `membres.ttl`,
`inbox/`, `space.ttl` or any `.acl`, and `space.ttl` is not even read by the tile. One write is expected, once,
and is not the tile's: the sign-in brings home's section of `settings/README.md` up to date, because the
footprint list grew with this slice (and, if the space isn't in the public Type Index yet, it is listed there).

**Observed:**

---

## 15 · Tile A starts from a file (#73)

Signed out, tile A fills from a file someone already has, read by the map (`/api/read-url`); nothing is written
until the coordinator publishes as usual. Production, throwaway accounts (`zz-`), 1541×751, network tab open.

**(a) A space with networks (Ingegno, read only).** **Do:** fresh private window, home, tile A: "Already have a
SpaceAPI file? Start from it", paste
`https://gitlab.com/de-creatieve-stem-group/map-ingegno-maker-space/-/raw/main/ingegno-maker-space-drongen-gent-2026-09-23.json`,
"Read it". **Expect:** one `POST /api/read-url`, nothing else; the form shows the name, street "Antoon
Catriestraat 6, Drongen", city Gent, the pin line at 51.0503, 3.6574 · Gent · 9031 · BE without "Working out where
that is"; email, Matrix room, website, logo, description filled; one line "Not carried over from your file:
next_event, state"; "Also from your file" names the networks, goals, topics, hours and the two links (Facebook, Instagram). No scroll added at 1541×751. Reload: everything is
still there (the draft keeps the networks too, check `localStorage` `mom-home:draft:space` holds `memberOf`).

**(b) Mother Sands to a zz pod.** **Do:** "Start over", then import
`https://mapsofmaking.org/canary/mother-sands.json`. **Expect:** "Not carried over" names `ext_canary`, `ext_fab`,
`issue_report_channels`, `state`, `timezone: UTC+0`, `contact.irc` (and `country_code: sol-3` until the canary file says `XZ`); the
twitter handle is a link under "Also from your file". The country is `XZ` (international waters), or, on the old file, the field is open and empty: type `XZ`. Change the name to "zz Mother Sands", "Show me my card", "Publish
it", pod door, `zz-mothersand`, sign in, publish the file. **Expect:** `space.ttl` holds `mom:memberOf
<urn:mak:network/canary>, <urn:mak:network/vulca>` and `mom:sdgs 9, 11, 12, 14, 17`. With the canary's own name, "Put it on the
map" is refused (`name_taken`, map #85, §16 (c)); under another name it makes a new pin: delete the zz record and
the account with the admin TUI.

**(c) A network (Maakbib's pod file).** **Do:** fresh window, import `https://maakbib.pod.mapsofmaking.org/space.ttl`.
**Expect:** "A network" pressed, area Flanders picked with its pin, nothing not carried over.

**(d) `?from=`.** **Do:** open `https://home.mapsofmaking.org/?from=https://mapsofmaking.org/canary/mother-sands.json`
in a fresh window. **Expect:** the address bar loses `?from=…`, the form fills by itself. Again in a window that
has a draft: the box holds the address, nothing is read until "Read it".

**(e) Failures.** `https://example.org/` (a web page): "That file can't be read: …" with the map's reason, focus
back in the box, the draft untouched. Signed in, tile A shows no import line.

## 16 · A network's members on the map, and a name already taken (#74)

Production, 1541×751. Needs map #95 deployed (`/api/network-members`). Nothing in this section writes anywhere
except (c), which writes a zz pod's own file.

**(a) Maakbib's list.** **Do:** sign in as Maakbib, open "Welcome your members" (done). **Expect:** under the link
and "Requests to join…", "Spaces on the map that say they're in" with one row, Ingegno Maker Space (its card link
opens `?space=ingegno-maker-space-drongen`), "Still a file: …", `info@decreatievestem.be · #ingegnomakerspace:matrix.org`
as text. The `maakbib-*` pods are not listed: their files don't name Maakbib (`mom:memberOf`), as expected. One
`GET /api/network-members` in the network tab; no other request. The page adds no scroll with the message folded.

**(b) The message.** **Do:** "See the message", then "Copy their message", paste it somewhere. **Expect:** it names
Ingegno and Maakbib, holds the invitation link (`https://backoffice.mapsofmaking.org/?collective=…config.ttl`) and
a claim link `https://home.mapsofmaking.org/?from=https%3A%2F%2Fgitlab.com%2F…json`; "Copied. Send it to them
yourself." beside the button, the message still open. Open the claim link in a fresh private window: tile A fills
from Ingegno's JSON (as §15 (a)).

Publishing that one ends on the same quiet line as (c) since map #95 (same name within 25 km of Ingegno's pin,
whatever its id); before #95 it made a second pin. (c) uses the canary, which never risks one.

**(c) A name already on the map.** **Do:** fresh private window, import
`https://mapsofmaking.org/canary/mother-sands.json` and keep its name "Mother Sands" (the canary's id is always
taken), publish through a `zz-mothersand` pod up to "Put it on the map". **Expect:** the file and public steps
done; the map step says "A space with this name is already on the map, from another address, so the map kept that
one. …", no "press again"; no second Mother Sands pin. Then delete the zz account with the admin TUI.

**(d) The map down.** With the network tab blocking `/api/network-members`, reopen the tile. **Expect:** "The map
didn't answer, so this list can't be shown now. Your invitation link above still works." and the link and "Copy the
link" still there.

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
