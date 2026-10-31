/**
 * The signed-out page: onboarding (Story 14.1 AC1b, AC7). Header, then "What
 * you can do" and the step side by side, 50/50 (design system: Workbench,
 * Layout). The hex column holds still; only the step panel scrolls. Under
 * 900px the panels stack (the folded HexRow comes with S5).
 *
 * Signed out, what is done lives in memory (AC4); the tiles that complete
 * things come with 14.2 onward.
 */
import { tally, tileStates } from "../tree/fog";
import type { Tree } from "../tree/parse";
import { renderHexView } from "./hexview";
import type { Draft } from "./previews";
import { renderStep } from "./step";

export interface OnboardingOptions {
  done: ReadonlySet<string>;
  draft: Draft;
  onSignIn: () => void;
}

export function renderOnboarding(root: HTMLElement, tree: Tree, opts: OnboardingOptions): void {
  const states = tileStates(tree.tiles, opts.done);
  const { cleared, open } = tally(states);
  const firstOpen = tree.tiles.find((t) => states.get(t.id) === "open") ?? tree.tiles[0];
  let selected = firstOpen.id;

  root.innerHTML = `
    <div class="wb-page">
      <header class="wb-header">
        <div class="wb-mark">
          <a class="logo app-mark" href="https://mapsofmaking.org/">maps of making</a>
          <span class="app">home</span>
        </div>
        <div class="wb-who">
          <span>On the map already? <button type="button" class="inline-link" id="sign-in">Sign in</button></span>
        </div>
      </header>
      <main class="wb-grid">
        <section class="wb-panel wb-hex-panel" aria-labelledby="hex-title">
          <div class="wb-panel-head">
            <h1 id="hex-title" data-view-title tabindex="-1">What you can do</h1>
            <span class="tally">Cleared <b>${cleared}</b> · Open <b>${open}</b></span>
          </div>
          <div class="wb-panel-body wb-hex-body" id="hexes"></div>
        </section>
        <section class="wb-panel wb-step-panel" aria-label="Step">
          <div class="wb-panel-body" id="step"></div>
        </section>
      </main>
    </div>`;

  const hexes = root.querySelector<HTMLElement>("#hexes")!;
  const step = root.querySelector<HTMLElement>("#step")!;

  const draw = () => {
    hexes.innerHTML = renderHexView(tree.tiles, states, selected);
    const tile = tree.tiles.find((t) => t.id === selected)!;
    step.innerHTML = renderStep(tile, { tiles: tree.tiles, states, draft: opts.draft });
    step.scrollTop = 0;
  };
  draw();

  hexes.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-tile]");
    if (!button || button.dataset.tile === selected) return;
    selected = button.dataset.tile!;
    draw();
    // The hexes were redrawn: keep the keyboard where it was.
    hexes.querySelector<HTMLButtonElement>(`button[data-tile="${CSS.escape(selected)}"]`)?.focus();
  });
  root.querySelector("#sign-in")!.addEventListener("click", opts.onSignIn);
}
