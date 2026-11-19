/**
 * The tree for the kind of thing the coordinator picked (2026-11-19): tiles after A speak to a space or to a
 * network. The variants are data (`*ForNetwork` in onboarding.ttl, read by parse.ts); this is the one place
 * that lays them over the space's words, so every caller that draws a title, a cue, a lead, a line of
 * Bernard's or a `ui*` line reads the tree it is given and gets the right one. A variant that is missing
 * falls back to the space's line, which already fits both kinds.
 */
import type { ContactType, Lines, ProfileField, Section, Tile, Tree, WordsNetwork } from "./parse";

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

const cache = new WeakMap<Tree, Tree>();

/** The tree as a network reads it; any other kind (a space, or none yet) reads the tree as it is. */
export function forKind(tree: Tree, kind: string | undefined): Tree {
  if (kind !== "network") return tree;
  let out = cache.get(tree);
  if (!out) {
    out = {
      ...tree,
      tiles: tree.tiles.map(tileFor),
      profile: {
        sections: tree.profile.sections.map((s: Section) => wordsFor(s)),
        fields: tree.profile.fields.map((f: ProfileField) => wordsFor(f)),
        contactTypes: tree.profile.contactTypes.map((c: ContactType) => wordsFor(c)),
      },
    };
    cache.set(tree, out);
  }
  return out;
}
