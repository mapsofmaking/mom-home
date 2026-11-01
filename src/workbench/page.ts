/**
 * One page, two modes (Story 14.1 AC1b): signed out it onboards, signed in
 * through the pod it is the workbench. A returning coordinator never steps
 * through onboarding again.
 *
 * Full: header, then "What you can do" and the step side by side, 50/50
 * (design system: Workbench, Layout). The hex column holds still; only the
 * step panel scrolls.
 *
 * Folded (AC7): the hex view folds into one row above the step (hexrow.ts);
 * in the workbench the row is the HexRow toolbar, with pictos. Words live in
 * the full view and are hidden with it.
 *
 * Fold is one state of the page, never of a tile (Nicolas, 2026-10-31: the
 * dry run's fold followed the selected tile, and the page seemed to move by
 * itself). It changes twice only: once on purpose, after tile C's tutorial
 * (`foldForFirstTime`, 14.6), and whenever the coordinator uses the toggle,
 * "Fold" / "Show all", in the same corner of the hex panel. Picking a tile
 * never moves the layout. The shell keeps the state (`FoldState`): for the
 * tab signed out, in settings/mom-home.ttl signed in (S6). Unset, a desktop
 * arrives unfolded and a phone folded, so the form leads.
 *
 * The hex view scales to its panel, the way the dry run's does: the whole
 * tree is always in sight, larger on a large screen, never a scrollbar.
 *
 * Signed out, what is done lives in memory (AC4): "Show me my card" marks
 * tile A done here, in this tab. What was typed outlives the tab: the shell
 * keeps the draft in this browser for 30 days (14.2 AC7, `onDraft`).
 */
import { tally, tileStates } from "../tree/fog";
import { completableIds } from "../tiles/done";
import { announce } from "../ui/a11y";
import type { Tree } from "../tree/parse";
import {
  askStartOver,
  describeWords,
  showMore,
  describeCommit,
  describeEdited,
  describeKeydown,
  describeNormalise,
  fillExample,
  missing,
  readDescribeForm,
  syncCta,
} from "./describe";
import { locate, pinByHand, pinned, unpin } from "./where";
import { esc } from "./html";
import { renderHexRow } from "./hexrow";
import { renderHexView } from "./hexview";
import type { Draft } from "./previews";
import { renderStep } from "./step";
import { metWords, renderWords } from "./words";

export interface PageOptions {
  /** The session decides (AC1b). */
  mode: "onboarding" | "workbench";
  /** Signed in: the name to show, "Signed in as <name>". */
  who?: string;
  /** Mutable: tiles done. Signed out, in this tab only (AC4); signed in, read from the pod (S6). */
  done: Set<string>;
  draft: Draft;
  /** Signed out, the draft changed: the shell keeps it in this browser (14.2 AC7). Empty: it was cleared. */
  onDraft?: (draft: Draft) => void;
  /** Shared with the shell, so the fold outlives a redraw and a sign-in. */
  fold: FoldState;
  /** The coordinator folded or unfolded: the shell keeps it (signed in, in settings/mom-home.ttl). */
  onFold?: (folded: boolean) => void;
  onSignIn: () => void;
  onSignOut: () => void;
}

/** null: never set, the width decides. */
export interface FoldState {
  folded: boolean | null;
}

export interface PageHandle {
  /** The one planned fold, at the end of tile C's tutorial (14.6). */
  foldForFirstTime(): void;
  /** Removes the page's listeners and observers: call before drawing another page into the same root. */
  destroy(): void;
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
  // Bounded: a desktop panel. Unbounded (stacked on a phone): the width
  // decides and the stage takes the height it needs.
  const bounded = matchMedia(WIDE).matches;
  const availW = stage.clientWidth;
  const availH = bounded ? stage.clientHeight : Infinity;
  if (!availW || (bounded && !availH)) return;
  const s = Math.min(availW / w, availH / h, MAX_SCALE);
  stage.style.height = bounded ? "" : `${(h * s).toFixed(0)}px`;
  view.style.transform = `translate(${((availW - w * s) / 2).toFixed(1)}px, ${
    bounded ? ((availH - h * s) / 2).toFixed(1) : 0
  }px) scale(${s.toFixed(3)})`;
}

/**
 * A tile name's tip opens rightward from its hex; in the right half of the
 * row it opens leftward, so it never pushes past the screen's edge (hidden
 * tips still take width).
 */
function alignTips(row: HTMLElement): void {
  const mid = row.getBoundingClientRect().left + row.clientWidth / 2;
  row.querySelectorAll<HTMLElement>(".hx.tool").forEach((hex) => {
    const r = hex.getBoundingClientRect();
    hex.classList.toggle("tip-end", r.left + r.width / 2 > mid);
  });
}

export function renderPage(root: HTMLElement, tree: Tree, opts: PageOptions): PageHandle {
  let selected: string | null = null;
  let editing = false;
  const workbench = opts.mode === "workbench";
  // Everything that outlives the markup (root and media-query listeners,
  // observers) is undone by destroy(), so a redraw never stacks a second set.
  const life = new AbortController();
  const observers: ResizeObserver[] = [];
  const completable = completableIds(tree);
  /** Tile A's words, from the tree (14.2 AC8): one reader for the page, so a missing line warns once. */
  const words = describeWords(tree.tiles.find((t) => t.act === "describe"));

  const who = workbench
    ? `<span>Signed in as <b>${esc(opts.who ?? "")}</b></span>
       <button type="button" class="btn" id="sign-out">Sign out</button>`
    : `<span>On the map already? <button type="button" class="inline-link" id="sign-in">Sign in</button></span>`;

  root.innerHTML = `
    <div class="wb-page">
      <h1 class="visually-hidden" data-view-title tabindex="-1">Maps of Making home</h1>
      <header class="wb-header">
        <div class="wb-mark">
          <a class="logo app-mark" href="https://mapsofmaking.org/">maps of making</a>
          <span class="app">home</span>
        </div>
        <div class="wb-who">${who}</div>
      </header>
      <main class="wb-grid">
        <section class="wb-panel wb-row-panel" id="row" hidden></section>
        <section class="wb-panel wb-hex-panel" id="full" aria-labelledby="hex-title">
          <div class="wb-panel-head">
            <h2 id="hex-title">What you can do</h2>
            <span class="tally" id="tally"></span>
            <button type="button" class="btn wb-fold" id="fold" aria-expanded="true">Fold</button>
          </div>
          <div class="wb-panel-body wb-hex-body">
            ${LEGEND}
            <div class="hx-stage" id="hexes"></div>
            <div id="words"></div>
          </div>
        </section>
        <section class="wb-panel wb-step-panel" aria-label="Step">
          <div class="wb-panel-body" id="step"></div>
        </section>
      </main>
    </div>`;

  const page = root.querySelector<HTMLElement>(".wb-page")!;
  const row = root.querySelector<HTMLElement>("#row")!;
  const full = root.querySelector<HTMLElement>("#full")!;
  const hexes = root.querySelector<HTMLElement>("#hexes")!;
  const step = root.querySelector<HTMLElement>("#step")!;
  const tallyEl = root.querySelector<HTMLElement>("#tally")!;
  const wordsEl = root.querySelector<HTMLElement>("#words")!;
  /** The word whose tip a tap pinned open. */
  let openWord: string | null = null;
  let met = metWords(tree, opts.done);

  const drawWords = () => {
    wordsEl.innerHTML = renderWords(tree, opts.done, openWord);
  };

  const wide = matchMedia(WIDE);
  const folded = () => opts.fold.folded ?? !wide.matches;

  /** Folded: the row above the step. Unfolded: the full view, 50/50 or stacked. */
  const layout = () => {
    const isFolded = folded();
    page.classList.toggle("is-folded", isFolded);
    row.hidden = !isFolded;
    full.hidden = isFolded;
    alignTips(row);
    fit(hexes);
  };

  /** The toggle: the coordinator's choice, kept by the shell. Focus follows to the other control. */
  const setFolded = (value: boolean) => {
    opts.fold.folded = value;
    layout();
    opts.onFold?.(value);
    // Folded, the way back is whichever bar the width shows (hexrow.ts: toolbar or phone strip).
    const back = [...root.querySelectorAll<HTMLElement>("[data-unfold]")].find((b) => b.getClientRects().length);
    (value ? (back ?? root.querySelector<HTMLElement>("#unfold")) : root.querySelector<HTMLElement>("#fold"))?.focus();
  };

  const draw = () => {
    const states = tileStates(tree.tiles, opts.done, completable);
    const { cleared, open } = tally(states);
    tallyEl.innerHTML = `Cleared <b>${cleared}</b> · Open <b>${open}</b>`;
    if (!selected || states.get(selected) === "fog") {
      // An open tile, else the first one reached, never a fog tile ("Still to discover" reads as a dead page).
      selected = (
        tree.tiles.find((t) => states.get(t.id) === "open") ??
        tree.tiles.find((t) => states.get(t.id) !== "fog") ??
        tree.tiles[0]
      ).id;
    }
    hexes.innerHTML = renderHexView(tree.tiles, states, selected);
    row.innerHTML = renderHexRow(tree.tiles, states, selected);
    if (!row.hidden) alignTips(row);
    // A word unlocks right after its tile (AC5): say so once, politely.
    const nowMet = metWords(tree, opts.done);
    const fresh = tree.words.filter((w) => nowMet.has(w.id) && !met.has(w.id));
    met = nowMet;
    if (fresh.length) announce(`New word: ${fresh.map((w) => w.label).join(", ")}. It's under What you can do.`);
    drawWords();
    fit(hexes);
    const tile = tree.tiles.find((t) => t.id === selected)!;
    step.innerHTML = renderStep(tile, { tiles: tree.tiles, states, draft: opts.draft, editing, words });
    step.scrollTop = 0;
  };

  const select = (id: string) => {
    selected = id;
    editing = false;
    draw();
  };

  layout();
  draw();
  observers.push(new ResizeObserver(() => fit(hexes)), new ResizeObserver(() => alignTips(row)));
  observers[0].observe(hexes);
  observers[1].observe(row);
  // Only an unset fold follows the width; a chosen one stays chosen.
  wide.addEventListener("change", layout, { signal: life.signal });

  hexes.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-tile]");
    if (!button || button.dataset.tile === selected) return;
    select(button.dataset.tile!);
    // The hexes were redrawn: keep the keyboard where it was.
    hexes.querySelector<HTMLButtonElement>(`button[data-tile="${CSS.escape(selected!)}"]`)?.focus();
  });

  row.addEventListener("click", (event) => {
    const target = (event.target as Element).closest<HTMLButtonElement>("button");
    if (!target) return;
    if (target.hasAttribute("data-unfold")) {
      setFolded(false);
      return;
    }
    if (target.dataset.tile && target.dataset.tile !== selected) {
      select(target.dataset.tile);
      row.querySelector<HTMLButtonElement>(`button[data-tile="${CSS.escape(selected!)}"]`)?.focus();
    }
  });
  root.querySelector("#fold")!.addEventListener("click", () => setFolded(true));

  step.addEventListener("submit", (event) => {
    const form = event.target as HTMLFormElement;
    if (form.id !== "f-describe") return;
    event.preventDefault();
    const empty = missing(form);
    if (empty) {
      empty.focus();
      return;
    }
    // Enter in the last field submits without leaving it: tidy every field first.
    for (const el of [...form.elements]) describeNormalise(form, el, words);
    readDescribeForm(form, opts.draft);
    if (workbench) {
      // Done is read from the pod, never carried here (AC4); tile A is not connected to the pod until 14.2.
      announce(words.ui("uiNotOnPod"));
      return;
    }
    opts.done.add("describe");
    editing = false;
    draw();
    // The card's one way on (Nicolas, 14.2 S2): focus lands on "Publish it", the title when there is none.
    (step.querySelector<HTMLElement>('[data-go="keep"]') ?? step.querySelector<HTMLElement>(".wb-step-title"))?.focus();
  });

  // Tile A's keyboard flow (14.2 AC4); the form is redrawn with the step, so listen here.
  const describeForm = (event: Event) => (event.target as Element).closest<HTMLFormElement>("#f-describe");
  /** What the form holds now goes to the draft, and the shell keeps it (AC7). Never in the workbench: tile A isn't on the pod yet. */
  const keep = (form: HTMLFormElement) => {
    // A geocoder answer can land after the form was cleared or redrawn: a detached form is old news.
    if (workbench || !form.isConnected) return;
    readDescribeForm(form, opts.draft);
    opts.onDraft?.(opts.draft);
  };
  const located = (form: HTMLFormElement) => () => {
    syncCta(form);
    keep(form);
  };
  // A draft with a town and no pin (forwarded from genjson, 14.8; or left before the answer came) asks now.
  const resumed = step.querySelector<HTMLFormElement>("#f-describe");
  if (resumed && !workbench && resumed.querySelector<HTMLInputElement>("#f-city")?.value.trim() && !pinned(resumed)) {
    void locate(resumed, words, located(resumed));
  }
  step.addEventListener("keydown", (event) => {
    const form = describeForm(event);
    if (form) describeKeydown(form, event);
  });
  // Leaving street or city asks the geocoder (where.ts); typing in them drops the old pin.
  const where = new Set(["street", "city", "country"]);
  step.addEventListener("focusout", (event) => {
    const form = describeForm(event);
    if (!form) return;
    describeCommit(form, event.target);
    if (describeNormalise(form, event.target, words)) keep(form);
    const name = (event.target as HTMLInputElement).name;
    if (where.has(name)) void locate(form, words, located(form));
  });
  step.addEventListener("input", (event) => {
    const form = describeForm(event);
    if (!form) return;
    const target = event.target as HTMLInputElement;
    if (target.name === "country") target.value = target.value.toUpperCase();
    if (target.name === "street" || target.name === "city") unpin(form);
    if (target.name === "lat" || target.name === "lon") pinByHand(form, words);
    describeEdited(form, target);
    syncCta(form);
    keep(form);
  });

  step.addEventListener("click", (event) => {
    const target = (event.target as Element).closest<HTMLElement>("button");
    if (!target) return;
    if (target.id === "example") {
      const form = step.querySelector<HTMLFormElement>("#f-describe")!;
      fillExample(form, words);
      unpin(form);
      keep(form);
      void locate(form, words, located(form));
    } else if (target.id === "more") {
      const form = step.querySelector<HTMLFormElement>("#f-describe")!;
      showMore(form, true);
      // The fold's button goes away with it: focus goes to what it opened.
      form.querySelector<HTMLInputElement>("#f-description")?.focus();
    } else if (target.id === "start-over" || target.id === "clear-no") {
      askStartOver(step.querySelector<HTMLFormElement>("#f-describe")!, target.id === "start-over");
    } else if (target.id === "clear-yes") {
      for (const k of Object.keys(opts.draft)) delete (opts.draft as Record<string, unknown>)[k];
      opts.onDraft?.(opts.draft);
      // Signed out, a card with nothing behind it isn't done either.
      if (!workbench) opts.done.delete("describe");
      editing = false;
      draw();
      step.querySelector<HTMLInputElement>("#f-name")?.focus();
      announce(words.ui("uiCleared"));
    } else if (target.id === "fix") {
      editing = true;
      draw();
      step.querySelector<HTMLInputElement>("#f-name")?.focus();
    } else if (target.dataset.go) {
      select(target.dataset.go);
      step.querySelector<HTMLElement>(".wb-step-title")?.focus();
    }
  });

  // A tap pins a word's tip open (and closes the one before); Escape or a
  // tap anywhere else closes it. Hover and focus need no script (workbench.css).
  wordsEl.addEventListener("click", (event) => {
    const chip = (event.target as Element).closest<HTMLButtonElement>("button[data-word]");
    if (!chip) return;
    openWord = openWord === chip.dataset.word ? null : chip.dataset.word!;
    drawWords();
    wordsEl.querySelector<HTMLButtonElement>(`button[data-word="${CSS.escape(chip.dataset.word!)}"]`)?.focus();
  });
  root.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && openWord) {
        openWord = null;
        drawWords();
      }
    },
    { signal: life.signal }
  );
  root.addEventListener(
    "click",
    (event) => {
      // The path, not target.closest: a tap on a chip redraws the strip first,
      // and the detached target would read as a tap outside.
      if (openWord && !event.composedPath().includes(wordsEl)) {
        openWord = null;
        drawWords();
      }
    },
    { signal: life.signal }
  );

  root.querySelector("#sign-in")?.addEventListener("click", opts.onSignIn);
  root.querySelector("#sign-out")?.addEventListener("click", opts.onSignOut);

  return {
    foldForFirstTime() {
      if (opts.fold.folded === null || opts.fold.folded === false) setFolded(true);
    },
    destroy() {
      life.abort();
      observers.forEach((o) => o.disconnect());
    },
  };
}
