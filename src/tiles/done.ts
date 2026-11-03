/**
 * Done is read from the space's own data, never stored (Story 14.1 AC4: "the
 * pod is the map"). Done belongs to a space, not to whoever signs in: the
 * signer may be a person coordinating several spaces, or none yet, so every
 * check takes the space as an input (docs/explanation/home-people-and-spaces.md
 * in maps_of_making). One check per tile id; each reads the space's own data and answers
 * true only on proof. `onb:doneWhen` in the tree says, as documentation, what
 * each check looks for; SPARQL/SHACL evaluation is out of scope.
 *
 * Most checks are stubs until their tile is real: a stub answers false, it
 * never guesses (14.2–14.6 replace them one at a time). A check that fails to
 * read counts as not done and says so in the console: a missing tile beats a
 * page that won't load.
 */
import type { Tree } from "../tree/parse";
import type { Draft } from "../workbench/previews";

export interface DoneContext {
  /** Who signed in: a person, or a space's own account. Never assumed to be the space. */
  webId: string;
  /** The signer's pod root (kit getPrimaryPodUrl): where their settings live, not the space's data. */
  podRoot: string;
  /**
   * The space being worked on: its card's IRI, registered as a mom:Space in a
   * Type Index. null while none is found (the lookup and the card come with
   * 14.3/14.4; several spaces per person = a picker, later).
   */
  space: string | null;
  /** What the space's file says, read at sign-in (#11); null when there is no file. */
  spaceData?: Draft | null;
  /** The space is on the map (S3 sets it from the register answer); until then tile B is not done. */
  onMap?: boolean;
}

export type DoneCheck = (ctx: DoneContext) => Promise<boolean>;

const notYet: DoneCheck = async () => false;

/** The tiles whose check can say yes today: a stub never can (fog.ts: they take open slots first). */
export function completableIds(tree: Tree): Set<string> {
  return new Set(tree.tiles.filter((t) => Object.hasOwn(DONE_CHECKS, t.id) && DONE_CHECKS[t.id] !== notYet).map((t) => t.id));
}

export const DONE_CHECKS: Readonly<Record<string, DoneCheck>> = {
  // keep, "Publish it": a space is published when its card is registered and
  // readable. Having a pod proves nothing: a person's own pod has storage too
  // (that false positive shipped in S6 and was caught the same day). The
  // card's address and the self-hosted door come with 14.3/14.4.
  // A file in the pod is not yet "published": it is private until S2 and off the map until S3.
  keep: async (ctx) => ctx.space !== null && ctx.onMap === true,
  // describe: nobody publishes without describing. The card's own check (name
  // and address in it) replaces this with 14.2/14.3.
  // describe: the space's file says a name, a town and a pin (#11): what a card needs.
  describe: async (ctx) => {
    const d = ctx.spaceData;
    return ctx.space !== null && !!(d?.name && d.city && d.lat && d.lon);
  },
  change: notYet, // → 14.6: hours modified after the card was created
  join: notYet, // → its story: org:memberOf a network
  event: notYet,
  answer: notYet,
  second: notYet,
  peers: notYet,
  agenda: notYet,
  handover: notYet,
  // discord (planned), mentor and bridge (emergent) never open: no check needed.
};

/** The tiles done, checked in parallel. A tile with no check, or whose check fails, is not done. */
export async function readDone(tree: Tree, ctx: DoneContext): Promise<Set<string>> {
  const results = await Promise.all(
    tree.tiles.map(async (t) => {
      // Own keys only: a tile id like "constructor" must not find an inherited function.
      const check = Object.hasOwn(DONE_CHECKS, t.id) ? DONE_CHECKS[t.id] : undefined;
      if (!check) return null;
      try {
        return (await check(ctx)) ? t.id : null;
      } catch (err) {
        console.warn(`Done check for "${t.id}" failed; counted as not done.`, err);
        return null;
      }
    })
  );
  return new Set(results.filter((id): id is string => id !== null));
}
