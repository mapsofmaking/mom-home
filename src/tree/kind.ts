/**
 * The tree for the kind of thing the coordinator picked (2026-11-19): tiles after A speak to a space or to a
 * network. The variants are data (`*ForNetwork` in onboarding.ttl, read by parse.ts); this is the one place
 * that lays them over the space's words, so every caller that draws a title, a cue, a lead, a line of
 * Bernard's or a `ui*` line reads the tree it is given and gets the right one. A variant that is missing
 * falls back to the space's line, which already fits both kinds.
 *
 * It is also the one place that leaves out the tiles of another kind (`onb:forKind`, 2026-11-20): a network's
 * own tile ("Welcome your members") is not in a space's tree at all, so nothing draws it, opens it or checks it.
 * No kind picked yet reads as a space.
 */
import type { ContactType, Lines, ProfileField, Section, Tile, TileKind, Tree, WordsNetwork } from "./parse";

const merge = (base: Lines, over: Lines | undefined): Lines => (over && Object.keys(over).length ? { ...base, ...over } : base);

function tileFor(t: Tile): Tile {
  const n = t.network;
  if (!n) return t;
  return {
    ...t,
    title: n.title ?? t.title,
    cue: n.cue ?? t.cue,
    lead: n.lead ?? t.lead,
    leadShort: n.leadShort ?? t.leadShort,
    lines: merge(t.lines, n.lines),
    ui: merge(t.ui, n.ui),
  };
}

const wordsFor = <T extends { network?: WordsNetwork }>(x: T): T => (x.network ? { ...x, ...x.network } : x);

const cache = new WeakMap<Tree, Map<TileKind, Tree>>();

/** The tiles a kind sees: those for every kind, and its own. */
const seenBy = (kind: TileKind) => (t: Tile) => t.forKind === null || t.forKind === kind;

/** The tree as this kind reads it: a network's words and tiles for a network; a space (or no kind yet) the space's. */
export function forKind(tree: Tree, kind: string | undefined): Tree {
  const k: TileKind = kind === "network" ? "network" : "space";
  const byKind = cache.get(tree) ?? new Map<TileKind, Tree>();
  cache.set(tree, byKind);
  let out = byKind.get(k);
  if (!out) {
    const tiles = tree.tiles.filter(seenBy(k));
    out =
      k === "network"
        ? {
            ...tree,
            tiles: tiles.map(tileFor),
            profile: {
              sections: tree.profile.sections.map((s: Section) => wordsFor(s)),
              fields: tree.profile.fields.map((f: ProfileField) => wordsFor(f)),
              contactTypes: tree.profile.contactTypes.map((c: ContactType) => wordsFor(c)),
            },
          }
        : // Nothing to leave out: the tree itself, so a caller comparing trees sees no change.
          tiles.length === tree.tiles.length
          ? tree
          : { ...tree, tiles };
    byKind.set(k, out);
  }
  return out;
}
