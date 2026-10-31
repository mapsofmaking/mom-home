/**
 * The signed-out page: onboarding (Story 14.1 AC1b, AC7). Header, then "What
 * you can do" and the step side by side, 50/50 (design system: Workbench,
 * Layout). The hex column holds still; only the step panel scrolls. Under
 * 900px the panels stack (the folded HexRow comes with S5).
 *
 * The hex view scales to its panel, the way the dry run's does: the whole
 * tree is always in sight, larger on a large screen, never a scrollbar.
 *
 * Signed out, what is done lives in memory (AC4). Tile A's form is a feel of
 * the tile until 14.2: "Show me my card" marks it done here, in this tab.
 */
import { tally, tileStates } from "../tree/fog";
import type { Tree } from "../tree/parse";
import { fillExample, readDescribeForm } from "./describe";
import { renderHexView } from "./hexview";
import type { Draft } from "./previews";
import { renderStep } from "./step";

export interface OnboardingOptions {
  /** Mutable: tiles done in this tab. */
  done: Set<string>;
  draft: Draft;
  onSignIn: () => void;
}

/** Up to a quarter larger than the design system's 104px tile on a big screen. */
const MAX_SCALE = 1.25;
const WIDE = "(min-width: 901px)";

const LEGEND = `
  <div class="hx-legend" aria-hidden="true">
    <span><i class="hx-key done"></i>Done</span>
    <span><i class="hx-key open"></i>You can do it now</span>
    <span><i class="hx-key cue"></i>What comes after</span>
    <span><i class="hx-key fog"></i>Still to discover</span>
  </div>`;

/** Scales the view to its stage; on a phone the stage takes the height it needs. */
function fit(stage: HTMLElement): void {
  const view = stage.querySelector<HTMLElement>(".hx-view");
  if (!view) return;
  const w = parseFloat(view.style.width);
  const h = parseFloat(view.style.height);
  const wide = matchMedia(WIDE).matches;
  const availW = stage.clientWidth;
  const availH = wide ? stage.clientHeight : Infinity;
  if (!availW || (wide && !availH)) return;
  const s = Math.min(availW / w, availH / h, MAX_SCALE);
  stage.style.height = wide ? "" : `${(h * s).toFixed(0)}px`;
  view.style.transform = `translate(${((availW - w * s) / 2).toFixed(1)}px, ${
    wide ? ((availH - h * s) / 2).toFixed(1) : 0
  }px) scale(${s.toFixed(3)})`;
}

export function renderOnboarding(root: HTMLElement, tree: Tree, opts: OnboardingOptions): void {
  let selected: string | null = null;
  let editing = false;

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
            <span class="tally" id="tally"></span>
          </div>
          <div class="wb-panel-body wb-hex-body">
            ${LEGEND}
            <div class="hx-stage" id="hexes"></div>
          </div>
        </section>
        <section class="wb-panel wb-step-panel" aria-label="Step">
          <div class="wb-panel-body" id="step"></div>
        </section>
      </main>
    </div>`;

  const hexes = root.querySelector<HTMLElement>("#hexes")!;
  const step = root.querySelector<HTMLElement>("#step")!;
  const tallyEl = root.querySelector<HTMLElement>("#tally")!;

  const draw = () => {
    const states = tileStates(tree.tiles, opts.done);
    const { cleared, open } = tally(states);
    tallyEl.innerHTML = `Cleared <b>${cleared}</b> · Open <b>${open}</b>`;
    if (!selected || states.get(selected) === "fog") {
      selected = (tree.tiles.find((t) => states.get(t.id) === "open") ?? tree.tiles[0]).id;
    }
    hexes.innerHTML = renderHexView(tree.tiles, states, selected);
    fit(hexes);
    const tile = tree.tiles.find((t) => t.id === selected)!;
    step.innerHTML = renderStep(tile, { tiles: tree.tiles, states, draft: opts.draft, editing });
    step.scrollTop = 0;
  };

  const select = (id: string) => {
    selected = id;
    editing = false;
    draw();
  };

  draw();
  new ResizeObserver(() => fit(hexes)).observe(hexes);

  hexes.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-tile]");
    if (!button || button.dataset.tile === selected) return;
    select(button.dataset.tile!);
    // The hexes were redrawn: keep the keyboard where it was.
    hexes.querySelector<HTMLButtonElement>(`button[data-tile="${CSS.escape(selected!)}"]`)?.focus();
  });

  step.addEventListener("submit", (event) => {
    const form = event.target as HTMLFormElement;
    if (form.id !== "f-describe") return;
    event.preventDefault();
    readDescribeForm(form, opts.draft);
    opts.done.add("describe");
    editing = false;
    draw();
    step.querySelector<HTMLElement>(".wb-step-title")?.focus();
  });

  step.addEventListener("click", (event) => {
    const target = (event.target as Element).closest<HTMLElement>("button");
    if (!target) return;
    if (target.id === "example") {
      fillExample(step.querySelector<HTMLFormElement>("#f-describe")!);
    } else if (target.id === "fix") {
      editing = true;
      draw();
      step.querySelector<HTMLInputElement>("#f-name")?.focus();
    } else if (target.dataset.go) {
      select(target.dataset.go);
      step.querySelector<HTMLElement>(".wb-step-title")?.focus();
    }
  });

  root.querySelector("#sign-in")!.addEventListener("click", opts.onSignIn);
}
