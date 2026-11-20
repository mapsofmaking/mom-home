# Decisions

Dated decisions that shape home. Newest first. Each says what was decided, who decided it, and why. The work
itself is tracked in issues and on the `mapsofmaking` org project; older story files (Epic 14, stories 14.0 to
14.4) live in `maps_of_making/_bmad-output/implementation-artifacts/` as frozen references.

Kit-level decisions (Solid, ACLs, sign-in) are ADRs in the kit repo; this file only records home's own.

## 2026-11-20

- **After the first live run of the import (Nicolas):** a place outside any country (Mother Sands, at sea) has
  the country `XZ`: UN/LOCODE's "international waters", in ISO 3166's user-assigned range, so no country will
  ever take it; two letters, so the writers and the map take it as any country (the map labels it). And an
  imported contact is no longer a loss when tile C has a kind for it: a phone, Telegram, Signal, Discord,
  Mattermost, or any web address as a Link (`facebook`, `instagram`, `twitter: @x`, `mastodon: @u@host`);
  only what has no kind yet (IRC, XMPP, a mailing list) stays "not carried over". Not kept as a raw blob in
  `space.ttl`, and no count of missing fields, for now.

- **Tile A starts from a file someone already has** (#73, slice 2 of #72, `review`). Signed out, under the
  kind: "Already have a SpaceAPI file? Start from it", a web address read by the map (`POST /api/read-url`,
  maps_of_making #84, same origin). The form is filled (`src/lib/spaceapi-read.ts` `draftFromRecord`) and the
  coordinator goes through every beat as when typing. Its parts:
  - **Nothing is dropped silently.** "Not carried over from your file: …" names, on one line, the map's
    `unmapped` keys and what the draft can't hold: contacts other than email and Matrix (`contact.facebook`),
    a time zone, a country that isn't an ISO code (left empty, the form asks), a network the map wouldn't read.
  - **The pin is the file's**, named by its town, so the geocoder isn't asked again unless street or town
    change. The address string is split best-effort into street, postcode and town.
  - **The writers carry `memberOf`, `sdgs` and `knowsAbout`** (`space.ttl`: `mom:memberOf <IRI>`,
    `mom:sdgs`, `schema:knowsAbout`; JSON: `mom.memberOf`, `mom.sdgs`, `knowsAbout`), and the readers
    (`draftFromTurtle`, the browser's draft) keep them, so importing Ingegno and publishing keeps its four
    networks. A network is kept only as the map reads one: `urn:mak:network/<slug>` or an http(s) IRI.
    `Draft.network` (a name nothing set) is gone: an IRI is not a name, so previews keep their generic words.
  - **`?from=<url>`** puts the address in the box, and reads it at once only when this browser has no draft
    of its own (what was typed here is newer); it leaves the address bar either way.
  - **Not in this slice**: tile C showing the networks, goals and topics (read-only); contacts beyond email and
    Matrix (named as not carried over); remembering the source address for the move (map #85 decides where
    it lives: the signed-out draft is cleared at publish).

- **The networks epic, decided with Nicolas** (plan of 2026-11-20, epic #72). **Import is a URL read through the
  map**: a space already on the map through a SpaceAPI-style JSON starts tile A from that file's address, read
  by the map's API (no paste, no upload). **Moving the record proves ownership with `mom.movedTo` in the old
  JSON**: the map swaps the endpoint only when the old file points at the new one. **Inviting the spaces that
  claim to be members is copy text only**: home shows the words to send, Maps of Making sends nothing (no
  mail, no mailto). **The network's tile comes first**: "Welcome your members" (#69) opens before tile C for a
  network, because it is the network's door and it fixes the backoffice's accept failing on a missing roster.

- **A tile can be for one kind only** (#69). `onb:forKind "network"` on a tile draws it only for a network:
  `forKind` (`src/tree/kind.ts`) leaves it out of a space's tree (and out of a tree with no kind yet), so
  nothing draws, opens or checks it there. It is data like the `*ForNetwork` words; no tile's code names a
  kind. A tile may not require another kind's tile (the tree is refused).

- **"Welcome your members": the network becomes a Solid collective from home** (#69, `review`). The tile writes,
  each step only if missing and every new file with `If-None-Match: *`: `inbox/` (anyone signed in may
  append, as the backoffice's `createInbox`), the roster `membres.ttl` with rules of its own (only the
  owner), then `config.ttl` in the backoffice template's shape and public, then one line in `space.ttl`.
  Accepting and refusing stay in the backoffice; the tile ends on the invitation link. Its parts:
  - **No `/profile/` write.** Joins go to the inbox `config.ttl` names, and an Accept to the requester's own
    inbox; the network's profile needs an `ldp:inbox` only if it joins another collective. The `/profile/`
    rule of 2026-11-03 holds.
  - **Done is read from the pod, following `sc:roster`.** `config.ttl` at the pod root parses (the
    backoffice's `parseCollectiveConfig`, copied at `ea20fad`, kit ADR 004) and the roster and inbox it names
    exist. The file name is never assumed: Maakbib's hand-made config names `members.ttl` and reads done with
    nothing written. Only a 404 is "missing"; a 401 or 403 is the session, and nothing is written on it.
    A `config.ttl` that doesn't parse is shown as it is and never rewritten. Done also needs `config.ttl` readable
    by a stranger (read without the session, as an invitation is opened), so a half-failed public Read is not done.
  - **Home finishes only what it wrote** (after the adversarial review): a `config.ttl` is home's when its
    `rdfs:seeAlso` names this pod's `space.ttl`. One home didn't write that lacks something (its roster, its
    inbox, public Read) is said in plain words, with no button: never opened, finished or linked to from here.
    A `membres.ttl` already there is used only if it holds no statement. New rules on the inbox and the roster
    keep the named agents the folder passed on (never a class); rules home can't copy (a group) or would widen
    (a grant on the folder only) stop the setup. A 403 is "this account may not", not an ended session.
  - **Home writes `https://schema.org/` in `config.ttl`**, like `space.ttl`; the backoffice reads the slogan
    and description under both `http://` and `https://`, so it needs no change.
  - **The two descriptions stay apart, linked by `rdfs:seeAlso`** both ways (`config.ttl#slug` ↔
    `space.ttl#space`), never `owl:sameAs`, which would merge them. The description is prefilled once from
    `space.ttl` and then belongs to the invitation.
  - **The invitation goes to MoM's backoffice**, `https://backoffice.mapsofmaking.org` (`BACKOFFICE_URL` in
    `src/config.ts`): `/?collective=` and the address of `config.ttl`, encoded as the backoffice's own links.

## 2026-11-19

- **Tiles speak to the kind picked, and a network's hours are contact hours** (Nicolas, 2026-11-19). After tile A,
  a network is no longer told "your space": a line that names the kind has a network variant in the tree, the
  same predicate plus `ForNetwork` (`onb:uiDoorPodDescForNetwork`; not plain `Network`, which `uiKindNetwork`
  already is), and `forKind` (`src/tree/kind.ts`) lays them over the space's lines when the draft is a network.
  A line that fits both has no variant. Hours stay one field (`schema:openingHours`); for a network only the
  words change: "Contact hours", when people can reach the network.

- **A network's area is searched by name, anywhere; the file carries its code and its name** (Nicolas,
  2026-11-19, after testing tile A live; amends the entry below). The Belgium-only select is gone: one box,
  "Area served", where the coordinator types "Flanders", "Île-de-France" or "France"; after a pause the map's
  geocoder (`POST /api/geocode {"area_search", "lang": "en"}`) offers up to five areas and one is picked. The
  pick sets the area and its pin at the area's centre (lat, lon, fidelity from the offer, no second ask);
  typing again drops both. Each area is now a node, `schema:areaServed [ a schema:AdministrativeArea ;
  schema:identifier "BE-VLG" ; schema:name "Flanders" ]`, and `{"code", "name"}` in the SpaceAPI `mom` block;
  the bare `"BE-VLG"` #67 wrote is still read (no name). Nothing to pick (no match, the geocoder busy or away):
  the line says so and the card waits. There are no coordinates by hand for a network any more, since the
  area is what the map reads and only the geocoder names one. The "A space / A network" toggle shows the
  picked one in ink with a check mark. `maakbib.{ttl,json}` changed with the map's area-search PR.

- **Tile A describes a space or a network** (Nicolas, 2026-11-19; the map's side is maps_of_making #79). The first
  choice on the form is "A space or a network?"; a space is the default, so its form, file and checks are as
  before. A network has an **area**, not an address: `schema:areaServed`, one ISO 3166 code per statement
  (`BE`, `BE-VLG`), picked from the areas the map names (Belgium and its three regions for now; a select, so
  nothing the geocoder or the map can't read gets typed; both replaced the same day, see above). Its node is
  typed `mom:Network, schema:Organization`
  (the subject stays `<#space>`), and its pin sits at the area's centre, as the map's geocode proxy gives it,
  with `mom:geolocationFidelity` (`region`, `country`) saying how coarse it is. No `schema:address`: the
  map derives the country from the areas. The SpaceAPI JSON says the same in a `mom` block. Pinned to the
  map's `maakbib.{ttl,json}`. Left for later: the Type Index entry still says `mom:Space` for both kinds, and
  the map's pin read-back has no area yet, so the live card under tile B shows no "Serves" line.

- **The self-host door downloads SpaceAPI JSON, converted from the same draft as `space.ttl`** (Nicolas, 2026-11-19).
  Self-hosters know JSON and the map already reads it; Turtle stays the pod path. One draft, two writers, the
  same required parts and the same refusal of unsafe addresses; pinned to the map's fixture.

## 2026-11-04

- **The "Work in progress" notice is gone** (Nicolas). A coordinator can now create an account, put their space on
  the map and change it from home (tiles A to C), and the pod server lets an account be deleted
  (solid-css-overlay). The self-host door of tile B doesn't block anyone, and the next tiles arrive as they're
  built, so nothing on screen needs the warning. The 2026-11-02 note that pods made here are test pods, wiped
  before launch, was the notice's main message: whether that wipe still happens is open.

## 2026-11-03

- **No planned first fold, and no line teaching it** (Nicolas, after the live pass of 14.6 S3, #38; supersedes
  14.1 AC7's "first fold after tile C's tutorial"). Folding as the map caught up changed two things at once:
  the layout moved while the coordinator was looking for the new hours, which is the lesson of C3. The page
  never folds by itself. Fold / Unfold tiles (renamed from "Show all", and the phone strip's "See all", 2026-11-05, to pair with Fold) is plain enough to be found by curiosity. Unset, a desktop stays
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
  (option (a)); email recovery stays the safety net. Accounts can't be deleted from home on CSS 7.2; the admin TUI does it.
- **Live tests run on `pod.mapsofmaking.org` with throwaway accounts.** No wipe before launch is needed (2026-11-05): an admin TUI lists, selects and deletes accounts.
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
