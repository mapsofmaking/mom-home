# Workbench

The home app (`home.mapsofmaking.org`) is where a coordinator puts their space on the map and comes back to run it. Signed out, it onboards: describe your space, publish it, see it live. Signed in, the same page is the **workbench**: tiles that each open the right tool for one job. It shares the map's Daylight palette and riso language, with a calmer, roomier page layer on top. Its components are in the Workbench group: `Workbench`, `HexTile`, `HexRow` (with its toolbar variant), `TilePicto`, `WordChip`, `DoorCard`, `Field`, `Finder`, `Copyable`, `PreviewFrame`, plus `UnlockSteps` with the `.now` and `.tint` markers.

## Layout

- One screen at 1600×900, no page scroll: the header, then two panels at 50/50 (`.wb-grid`, gap `space-24`). Left: **What you can do** (the hex view). Right: the step. The hex column holds still; only the step panel scrolls.
- Page padding `space-20` × `space-28`; panel padding `space-20`. Both panels are `drawer-bg` with `stroke-rule` and the hard `shadow`. Nothing inside a panel has a shadow, door cards included.
- Under 900px the panels stack and the hex view folds into a `HexRow`: the form drives on a phone.
- Signed in, a tile's first open (its tutorial) keeps the full hex view, for continuity; from the next visit the tool opens with the hexes folded into the one-line `HexRow` toolbar (52px, pictos, tile name on hover) and the panel spans the page. A tool lays out as fields on the left (scrolling, under a `Finder`) and a preview held still on the right, with Save under the preview.
- Words you've met (`WordChip`) live under the full hex view and are hidden when it folds.
- Header: wordmark in `hand` at 26px, the app name `home` in mono beside it. Signed out, a quiet "On the map already? Sign in" `.inline-link` sits before Undo / Start over; signed in, "Signed in as <space>" and Sign out.

## Type

- `wb-title` (Inter Tight 20/600) for panel titles, `wb-body` (15px) for running text, `wb-door-title` (17/600) for door cards, `wb-label` (13/600) and `wb-input` (14px; 16px on phones) for forms.
- Bernard keeps `bernard` (Special Elite 17px) and opens with an em-dash. Hints, errors and labels are system voice.
- Mono labels (10px uppercase) frame previews and lists: "What you'd get · Preview · nothing is published".

## Colour

- Daylight only, from the map's tokens. `done-tint` (green printed thin over white) marks what is done: the done hex and the ✓ step marker. It is not a state colour and never carries text.
- **Riso red (`accent`) only for errors.** An error shows a red outline on the field and a `broken` `StatusLabel` ("Address taken"); the words stay ink. The step to take now is `ink` at 2.5px (`.sp-unlock-marker.now`), not red.
- **Hover lifts, it doesn't colour:** a pressable control keeps its colours and gains the hard `shadow`, 1px up-left; pressed, it lands. Hover only says "you can press this" (decided 2026-10-31).
- **Links are cobalt at rest, underlined;** on hover the underline thickens, the colour stays (2026-10-31). A link must read as one before any hover: phones have none.
- **Focus is riso blue (`accent-2`)**, 2.5px, offset 2px: never red, so a focused field never reads as an error, and never ink, so a focused hex never reads as the selected one (ink, 4px). Cobalt is 4.3:1 on paper, above the 3:1 a focus ring needs (decided 2026-10-31).
- A `HexTile` that is done or open carries its `TilePicto` above the label, the same picto as in the folded row, so a tile is known before the first fold. A done tile has no ✓: the green print says done. Coming and undiscovered tiles carry no picto, so the progression holds (2026-10-31).
- Hex tiles never share the panel's background: open tiles are `surface-white`, coming tiles `paper`, undiscovered ones `paper-2` with halftone dots.

## A step, top to bottom

1. **Bernard's line.** One or two sentences that name the stakes, never the mechanism.
2. **The work:** a form (`Field`), a choice (`DoorCard`), or a preview (`PreviewFrame`).
3. **One way out** in `.wb-out`: one primary button and at most one plain link ("Publish it →" · "Fix something first"). Never a menu of next steps; the hex view already shows what else is open.

No status badge on a workbench tile ("First time", "Done"): which mode opens is read from the pod, the coordinator doesn't need to see the switch.

## Tile labels

Each tile has two labels. The **cue** shows while the tile is still coming: it is the benefit, readable with no context ("Tell people what's on"). The **title** shows once it opens: the action, following the previous tile ("Publish it"). Read in order, cue then title goes why → how, and they never repeat each other. Name real consequences in plain words ("Needs your network to say yes"); never a level, a code or a mechanism.

## Honesty rules

- A preview shows only what the person typed and only readers that exist; it says "Preview · nothing is published". "Live" only when read back from the map.
- Refusing is an answer: a "Not now" link says what happens ("It stays in this browser. Nothing was sent.").
- Graceful failure: name what refused (the pod, the network, the map), never the coordinator; give one way forward; keep everything typed.

## Not synced yet

- The workbench layer comes from the "Onboard Storyboard" design canvas (2026-10-30), not from shipped code: Epic 14 builds it in [mom-home](https://github.com/mapsofmaking/mom-home), which pins a commit of the design-system repo (`tokens/workbench.css`). A change goes to that repo first, then here.
- Each workbench tile after "Publish it" becomes a mini-app with its own design. Tile C ("Update it once") is drawn in full on the storyboard and is the pattern; the others are still placeholders.
- No Depth or Bernard's Workshop treatment for the workbench yet; `done-tint` has a Depth value for completeness only.
