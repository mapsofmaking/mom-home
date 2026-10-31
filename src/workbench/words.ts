/**
 * Words you've met (Story 14.1 AC5): the strip under the full hex view.
 *
 * A word unlocks right after the tile that shows what it names
 * (`onb:unlocksWord`): the word follows the experience, never the other way
 * round. The strip stays hidden until the first one; after that every word
 * has a place, the ones not met yet as dashed dots, so the strip says there
 * is more without saying what.
 *
 * A met word is the design system's WordChip (`.wd`): its meaning
 * (`onb:meaning`) in a tip after 1 s of hover, at once on keyboard focus, on
 * tap (aria-pressed). Never the browser's `title`: it can't be styled, isn't
 * shown on touch and never on focus.
 */
import type { Tree } from "../tree/parse";
import { esc } from "./html";

export function metWords(tree: Tree, done: ReadonlySet<string>): Set<string> {
  return new Set(
    tree.tiles.filter((t) => t.unlocksWord && done.has(t.id)).map((t) => t.unlocksWord!)
  );
}

/** The strip, or "" while no word is met. `open` is the word whose tip a tap pinned open. */
export function renderWords(tree: Tree, done: ReadonlySet<string>, open: string | null = null): string {
  const met = metWords(tree, done);
  if (met.size === 0) return "";
  const chips = tree.words
    .map((w) =>
      met.has(w.id)
        ? `<li><button type="button" class="wd" data-word="${esc(w.id)}" aria-pressed="${w.id === open}"
              aria-describedby="tip-${esc(w.id)}">${esc(w.label)}<span class="tip" role="tooltip"
              id="tip-${esc(w.id)}">${esc(w.meaning)}</span></button></li>`
        : `<li><span class="wd locked" role="img" aria-label="A word not met yet">· · ·</span></li>`
    )
    .join("");
  return `
    <section class="wb-words" aria-labelledby="words-title">
      <p class="wf-label" id="words-title">Words you've met</p>
      <ul class="wb-word-list">${chips}</ul>
    </section>`;
}
