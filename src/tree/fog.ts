/**
 * The fog rules (Story 14.1 AC3): which tiles a coordinator sees, and how.
 *
 * - done: read from the pod (src/tiles/done.ts), or from memory signed out.
 * - open: requirements met, among the first MAX_OPEN by `prio`. Three at a
 *   time keeps the choice short.
 * - ready: requirements met, held back only by that limit. It says so.
 * - cue: next to something open or done, so it shows its outcome (the cue
 *   label), never its mechanism. Emergent and planned tiles stop here: they
 *   never open, whatever is done.
 * - fog: everything else, still to discover.
 *
 * Pure: the same tree and the same done set always draw the same view.
 */
import type { Tile } from "./parse";

export type TileState = "done" | "open" | "ready" | "cue" | "fog";

export const MAX_OPEN = 3;

export function requirementsMet(tile: Tile, done: ReadonlySet<string>): boolean {
  return (
    tile.requiresAll.every((id) => done.has(id)) &&
    (tile.requiresAny.length === 0 || tile.requiresAny.some((id) => done.has(id)))
  );
}

/**
 * `completable`: the tiles whose done check can say yes today (not a stub).
 * They take the open slots first, so a stub tile can never hold a real one
 * back as "ready" with a promise ("opens as soon as you clear one") that
 * nothing could keep. Omitted: every tile counts as completable.
 */
export function tileStates(
  tiles: readonly Tile[],
  done: ReadonlySet<string>,
  completable?: ReadonlySet<string>
): Map<string, TileState> {
  const states = new Map<string, TileState>();
  for (const t of tiles) states.set(t.id, done.has(t.id) ? "done" : "fog");

  const candidates = tiles
    .filter((t) => !done.has(t.id) && requirementsMet(t, done))
    .sort((a, b) => {
      const real = (t: Tile) => (!completable || completable.has(t.id) ? 0 : 1);
      return real(a) - real(b) || a.prio - b.prio;
    });
  let opened = 0;
  for (const t of candidates) {
    if (t.emergent || t.planned) states.set(t.id, "cue");
    else states.set(t.id, opened++ < MAX_OPEN ? "open" : "ready");
  }

  for (const t of tiles) {
    if (states.get(t.id) !== "fog") continue;
    const near = [...t.requiresAll, ...t.requiresAny].some((id) => {
      const s = states.get(id);
      return s === "open" || s === "done";
    });
    if (near) states.set(t.id, "cue");
  }
  return states;
}

/** Cleared and open, never a total: the tree keeps growing (AC3). */
export function tally(states: ReadonlyMap<string, TileState>): { cleared: number; open: number } {
  let cleared = 0;
  let open = 0;
  for (const s of states.values()) {
    if (s === "done") cleared++;
    else if (s === "open") open++;
  }
  return { cleared, open };
}
