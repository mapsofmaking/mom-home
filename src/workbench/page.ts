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
import { readOffers, type Offers } from "../lib/provider";
import { AccountError, createAccount, pendingEmail, type NewAccount, type SignUp } from "../lib/register";
import { markPodMade, type PodMade } from "../lib/handoff";
import type { OnMap } from "../lib/onmap";
import { PublishError, type FileResult, type PublicResult } from "../lib/publish";
import { IDLE, publishWords, renderPublishPanel, type PublishState } from "./publish";
import { DEFAULT_IDENTIFIER } from "../config";
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
import { suggestPodName } from "../lib/podname";
import {
  checkEmail,
  checkName,
  checkPass,
  checkPodForm,
  clearError,
  hidePassphrase,
  holdEmail,
  sayStatus,
  setCreating,
  showAccountError,
  showAddress,
  togglePassphrase,
  type PodFormState,
} from "./podform";
import { showsPodForm, thresholdWords, type Door, type OffersState } from "./threshold";
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
  /** What the pod server offers (tile B, 14.3 AC4); the app reads its descriptor, tests pass their own. */
  readOffers?: () => Promise<Offers>;
  /** Creates the account and pod (tile B, 14.3 AC3); the app uses lib/register.ts, tests pass their own. */
  createAccount?: (input: SignUp) => Promise<NewAccount>;
  /** Signs in at the pod server (Solid-OIDC redirect); the shell passes it, so this page never loads the auth library. */
  signIn?: () => Promise<void>;
  /** Back from that sign-in, the first draw (lib/handoff.ts): tile B says the pod is ready (14.3 AC6). Shown once. */
  podReady?: PodMade | null;
  /** Signed out, a pod this tab made and did not sign in to: offered before a form that would make a second account. */
  priorPod?: PodMade | null;
  /** Signed in with a pod: tile B puts the space on the map (Story 14.4). The shell passes it with the pod it knows. */
  publishSpace?: (draft: Draft) => Promise<FileResult>;
  /** Step 2 (S2, #12): anyone can read the space file, the rest of the pod stays private. */
  makePublic?: () => Promise<PublicResult>;
  /** Step 3 (S3, #13): register the file's address on the map, and read the pin back. */
  putOnMap?: (fileUrl: string) => Promise<OnMap>;
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
  // Back from the sign-in after creating the pod: tile B speaks first (AC6).
  let selected: string | null = opts.podReady ? (tree.tiles.find((t) => t.act === "threshold")?.id ?? null) : null;
  let editing = false;
  let carded = false; // workbench: the card is shown from the draft; done stays the pod's to say
  /** Signed in, what this tab has seen done before S4 reads it from the pod (on the map: tile B). Never written anywhere. */
  const doneHere = new Set<string>();
  /** What the screen shows as done: the pod's, plus this tab's card and what this tab put on the map. */
  const doneNow = () => {
    const extra = [...doneHere, ...(carded ? ["describe"] : [])].filter((id) => !opts.done.has(id));
    return extra.length ? new Set([...opts.done, ...extra]) : opts.done;
  };
  /** Tile B (14.3): what the pod server offers (null: not asked yet or being asked), and the door chosen. */
  let offers: OffersState = null;
  let offersAsked = false;
  let door: Door | null = null;
  /** The pod form's address and email, kept across redraws; the passphrase is never kept (podform.ts). */
  let pod: PodFormState | null = null;
  let podTimer: ReturnType<typeof setTimeout> | undefined;
  /** One "Create it" at a time (the gateway's rate limit counts every attempt). */
  let creating = false;
  /**
   * The pod made in this page. From then on "Create it" only signs in: register.ts
   * forgets the account once it is whole, so another create would make a SECOND
   * account, which CSS 7.2 can never delete.
   */
  let made: NewAccount | null = null;
  /** Signing in to the pod is under way: a second press must not start a second redirect. */
  let signingIn = false;
  /** "Pod ready" is said once: the first draw after the return, until the coordinator goes anywhere else. */
  let podReady: PodMade | null = opts.podReady ?? null;
  /** "Make another one" was chosen over signing in to the pod this tab already made. */
  let makeAnother = false;
  /** Where "Put it on the map" is (Story 14.4); a step in flight holds the screen still, like a create. */
  let publish: PublishState = { ...IDLE };
  let publishing = false;
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
    wordsEl.innerHTML = renderWords(tree, doneNow(), openWord);
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
    // Signed in, a card drawn in this tab opens tile B (the way to put it on the pod) until S4 reads tile A's done
    // from the pod itself. Nothing is added to opts.done: the pod's own record stays untouched.
    const states = tileStates(tree.tiles, doneNow(), completable);
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
    const nowMet = metWords(tree, doneNow());
    const fresh = tree.words.filter((w) => nowMet.has(w.id) && !met.has(w.id));
    met = nowMet;
    if (fresh.length) announce(`New word: ${fresh.map((w) => w.label).join(", ")}. It's under What you can do.`);
    drawWords();
    fit(hexes);
    const tile = tree.tiles.find((t) => t.id === selected)!;
    // Tile B's form fields follow the description until the coordinator types their own (no second copy that drifts).
    pod ??= { name: "", email: "", nameTouched: false, emailTouched: false, held: null, made: false };
    if (!pod.nameTouched) pod.name = suggestPodName(opts.draft.name);
    if (!pod.emailTouched) pod.email = (opts.draft.email ?? "").trim();
    // What the half-built account holds, and whether the pod exists, survive a redraw: they are the server's facts, not typing.
    pod.held = pendingEmail(DEFAULT_IDENTIFIER);
    pod.made = made !== null;
    clearTimeout(podTimer);
    step.innerHTML = renderStep(tile, { tiles: tree.tiles, states, draft: opts.draft, editing, carded, words, offers, door, pod, podReady: podReady?.pod ?? null, prior: opts.priorPod ?? null, makeAnother, publish: opts.publishSpace ? publish : null });
    step.scrollTop = 0;
    if (tile.act === "threshold" && !offersAsked) askOffers();
    // The suggested address is checked as soon as the form opens (AC2): a bad one shows before the passphrase is reached.
    const podForm = step.querySelector<HTMLFormElement>("#f-pod");
    if (podForm && pod.name) checkName(podForm, thresholdWords(tile));
  };

  /** Asks the pod server once the first time tile B opens (and again on "Try again"); the answer redraws it. */
  const askOffers = () => {
    offersAsked = true;
    offers = null;
    void (opts.readOffers ?? readOffers)().then((answer) => {
      if (life.signal.aborted) return;
      offers = answer;
      // Only if the coordinator is still looking at tile B, and not while a create is in flight (its form must stay).
      if (!creating && !publishing && tree.tiles.find((t) => t.id === selected)?.act === "threshold") {
        const had = document.activeElement?.getAttribute("data-door");
        draw();
        if (had) step.querySelector<HTMLElement>(`[data-door="${had}"]`)?.focus();
      }
    });
  };

  const select = (id: string) => {
    // A create is in flight: a redraw now would drop its answer (the form is replaced). Tiles wait for it.
    if (creating || publishing) return;
    podReady = null;
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
    if (form.id === "f-pod") {
      // Never the browser's own submit: it would put the passphrase in the URL (podform.ts).
      event.preventDefault();
      if (creating) return;
      const ui = thresholdWords(tree.tiles.find((t) => t.act === "threshold"));
      if (made) {
        void signInNow(form, ui, made);
        return;
      }
      sayStatus(form, "");
      const bad = checkPodForm(form, ui);
      if (bad) {
        bad.focus();
        return;
      }
      void create(form, ui);
      return;
    }
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
      // Done is the pod's to say (AC4), so the card is only shown, never marked done.
      carded = true;
      editing = false;
      draw();
      (step.querySelector<HTMLElement>('[data-go="keep"]') ?? step.querySelector<HTMLElement>(".wb-step-title"))?.focus();
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
      carded = false;
      draw();
      step.querySelector<HTMLInputElement>("#f-name")?.focus();
      announce(words.ui("uiCleared"));
    } else if (target.id === "fix") {
      editing = true;
      draw();
      step.querySelector<HTMLInputElement>("#f-name")?.focus();
    } else if (target.id === "publish-go") {
      void runPublish();
    } else if (target.id === "copy-address") {
      const said = step.querySelector<HTMLElement>("#copy-status");
      const ui = publishWords(tree.tiles.find((t) => t.act === "threshold"));
      // The address is on screen as text either way: a refused clipboard costs the shortcut, not the address.
      void navigator.clipboard
        ?.writeText(target.dataset.copy ?? "")
        .then(() => { if (said) said.textContent = ui("uiCopied"); })
        .catch(() => {});
    } else if (target.id === "prior-signin" && opts.priorPod) {
      void signInNow(step as unknown as HTMLFormElement, thresholdWords(tree.tiles.find((t) => t.act === "threshold")), opts.priorPod);
    } else if (target.id === "prior-another") {
      makeAnother = true;
      draw();
      step.querySelector<HTMLInputElement>("#p-name")?.focus();
    } else if (target.id === "pod-show") {
      togglePassphrase(step.querySelector<HTMLFormElement>("#f-pod")!, thresholdWords(tree.tiles.find((t) => t.act === "threshold")));
    } else if (target.dataset.door || target.id === "not-now" || target.id === "doors-again" || target.id === "offers-retry" || target.id === "pod-other") {
      if (target.id === "offers-retry") {
        askOffers();
        draw();
        step.querySelector<HTMLElement>("#offers-retry, [data-door]")?.focus();
        return;
      }
      door =
        target.id === "not-now" ? "notnow" : target.id === "doors-again" ? null : target.id === "pod-other" ? "self" : (target.dataset.door as Door);
      draw();
      // The form opened: the keyboard goes to its first field.
      if (showsPodForm({ offers, door })) {
        step.querySelector<HTMLInputElement>("#p-name")?.focus();
        return;
      }
      // Keyboard stays on what was pressed (or on what replaced it); the reply is said once, politely.
      step
        .querySelector<HTMLElement>(door ? `[data-door="${door}"], #doors-again` : "[data-door]")
        ?.focus();
      const reply = step.querySelector<HTMLElement>("#reply");
      if (reply) announce(reply.textContent?.replace(/\s+/g, " ").trim() ?? "");
    } else if (target.dataset.go) {
      select(target.dataset.go);
      step.querySelector<HTMLElement>(".wb-step-title")?.focus();
    }
  });

  /**
   * "Create it" (14.3 AC3): the account, its passphrase login, the pod, and the
   * account-API login, through lib/register.ts. The passphrase goes from its
   * input to that one call and is not kept. Every answer is said in place (AC5).
   */
  const create = async (form: HTMLFormElement, ui: ReturnType<typeof thresholdWords>) => {
    const field = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value;
    creating = true;
    setCreating(form, ui, true);
    try {
      made = await (opts.createAccount ?? ((i: SignUp) => createAccount(DEFAULT_IDENTIFIER, i)))({
        name: field("name").trim(),
        email: field("email").trim(),
        password: field("pass"),
      });
      if (!form.isConnected) return;
      setCreating(form, ui, false);
      // The passphrase is spent: out of the page before it leaves, so a Back from the provider can't bring it back.
      for (const name of ["pass", "pass2"]) (form.elements.namedItem(name) as HTMLInputElement).value = "";
      hidePassphrase(form, ui);
      markPodMade({ webId: made.webId, pod: made.pod });
      form.querySelector<HTMLButtonElement>('button[type="submit"]')!.textContent = ui("uiSignIn");
      sayStatus(form, ui("uiPodCreated", { address: made.pod }));
      announce(ui("uiPodCreated", { address: made.pod }));
      await signInNow(form, ui, made);
    } catch (err) {
      if (!form.isConnected) return;
      setCreating(form, ui, false);
      const error = err instanceof AccountError ? err : new AccountError("provider", String(err), false);
      // The account may already hold the email: from now on only the address can change.
      const held = pendingEmail(DEFAULT_IDENTIFIER);
      if (held) {
        holdEmail(form, ui, held);
        if (pod) pod.email = held;
      }
      const target = showAccountError(form, ui, error, opts.draft.city);
      target.focus();
    } finally {
      creating = false;
    }
  };

  /**
   * "Put it on the map" (14.4). The panel is redrawn in place, never the screen, so nothing moves under the
   * coordinator while a step runs; one press at a time. Each failure is said with its one way forward (AC5).
   */
  const runPublish = async () => {
    const tile = tree.tiles.find((t) => t.act === "threshold")!;
    const ui = publishWords(tile);
    const paint = (focus = false) => {
      const box = step.querySelector<HTMLElement>("#publish");
      if (!box) return;
      box.innerHTML = renderPublishPanel(tile, publish);
      const finished = publish.file === "done" && publish.pub === "done";
      if (focus) box.querySelector<HTMLElement>(finished ? "#publish-status" : "#publish-go")?.focus();
    };
    // All the steps or none: a panel that could end early would claim what didn't happen.
    if (publishing || !opts.publishSpace || !opts.makePublic || !opts.putOnMap) return;
    const { publishSpace, makePublic, putOnMap } = opts;
    publishing = true;
    // Each failure is said in the words of the step that failed (AC5).
    const say = (e: PublishError, stepName: "file" | "pub" | "map") => {
      const missing = e.missing.map((m) => ui(({ name: "uiMissingName", town: "uiMissingTown", country: "uiMissingCountry", pin: "uiMissingPin" } as const)[m]));
      const status = String(e.status ?? "no status");
      // The map's own failures: its silence is not the pod's.
      if (stepName === "map") return ui(e.code === "map-refused" ? "uiMapRefused" : "uiMapDown");
      switch (e.code) {
        case "incomplete": return ui("uiPublishIncomplete", { missing: missing.join(", ") });
        case "expired": return ui("uiPublishExpired");
        case "unreachable": return ui("uiPublishUnreachable");
        case "unreadable": return ui("uiPublishUnreadable");
        case "rules-unknown": return ui("uiPublicUnknown");
        case "rules-wider": return ui("uiPublicWider");
        case "no-control": return ui("uiPublicNoControl");
        case "conflict": return ui("uiPublicConflict");
        case "gone": return ui("uiPublicGone");
        case "no-wac": return ui("uiPublicNoWac");
        // Already public and still unreadable: pressing again won't help, so the line doesn't say to.
        case "not-public": return ui(e.rulesWere === "already-public" ? "uiPublicBlocked" : "uiPublicNotPublic", { status });
        default: return ui("uiPublishRefused", { status });
      }
    };
    const asError = (err: unknown) => (err instanceof PublishError ? err : new PublishError("refused", String(err)));
    let arrived = false;
    try {
      // A retry resumes from the step that failed (AC5): what is done is not done again, except that a
      // file the public step found gone is written anew.
      const fileOk = publish.file === "done" && !(publish.pub === "failed" && publish.failedCode === "gone");
      const pubOk = fileOk && publish.pub === "done";
      if (!fileOk) {
        publish = { ...IDLE, file: "working" };
        paint();
        let result: FileResult;
        try {
          result = await publishSpace(opts.draft);
        } catch (err) {
          publish = { ...publish, file: "failed", message: say(asError(err), "file") };
          return;
        }
        const address = result.url;
        const fileLine =
          result.status === "written"
            ? ui("uiStepFileWritten", { address })
            : result.status === "already-there"
              ? ui("uiStepFileThere")
              : ui("uiStepFileKept");
        const dropped = result.dropped.length
          ? ui("uiPublishDropped", { fields: result.dropped.map((k) => words.field(k).label.toLowerCase()).join(", ") })
          : "";
        publish = { ...publish, file: "done", fileLine, dropped, fileUrl: address };
        // The pod now holds a file with a name, a town and a pin (spaceFile refuses less): tile A is done in
        // this tab too, as it will be read from the pod at the next sign-in (#11).
        doneHere.add("describe");
      }
      if (!pubOk) {
        publish = { ...publish, pub: "working", map: "idle", message: "", failedCode: null };
        paint();
        try {
          const pub = await makePublic();
          publish = { ...publish, pub: "done", pubLine: ui(pub.status === "made-public" ? "uiStepPublicDone" : "uiStepPublicAlready") };
        } catch (err) {
          const e = asError(err);
          publish = { ...publish, pub: "failed", message: say(e, "pub"), failedCode: e.code };
          return;
        }
      }
      publish = { ...publish, map: "working", message: "" };
      paint();
      try {
        const onMap = await putOnMap(publish.fileUrl);
        publish = { ...publish, map: "done", onMap };
        arrived = true;
      } catch (err) {
        publish = { ...publish, map: "failed", message: say(asError(err), "map") };
      }
    } finally {
      publishing = false;
      if (arrived) {
        // On the map: tile B is done in this tab (S4 reads it from the pod), its word unlocks, and the
        // threshold replaces the steps. The whole page redraws; focus goes to the one way on.
        doneHere.add("keep");
        if (step.isConnected) {
          draw();
          (step.querySelector<HTMLElement>(".wb-out [data-go]") ?? step.querySelector<HTMLElement>(".wb-step-title"))?.focus();
        }
      } else if (step.isConnected) paint(true);
    }
  };

  /** To the pod's own page (Solid-OIDC). If it doesn't start, the pod still exists: say so, and the button signs in again. */
  const signInNow = async (form: HTMLFormElement, ui: ReturnType<typeof thresholdWords>, pod: { pod: string }) => {
    if (signingIn) return;
    signingIn = true;
    try {
      if (!opts.signIn) throw new Error("no sign-in available");
      await opts.signIn();
    } catch (err) {
      console.warn("Sign-in after creating the pod did not start:", err);
      if (!form.isConnected) return;
      sayStatus(form, ui("uiSignInFailed", { address: pod.pod }));
      form.querySelector<HTMLElement>('button[type="submit"], #prior-signin')?.focus();
    } finally {
      // A redirect that did start leaves the page; one that didn't can be tried again.
      signingIn = false;
    }
  };

  // The pod form (14.3 AC2): messages update in place, never by redrawing, so no error clears a field.
  const podForm = (event: Event) => (event.target as Element).closest<HTMLFormElement>("#f-pod");
  const podUi = () => thresholdWords(tree.tiles.find((t) => t.act === "threshold"));
  step.addEventListener("input", (event) => {
    const form = podForm(event);
    if (!form || !pod) return;
    const target = event.target as HTMLInputElement;
    if (target.name === "name") {
      pod.name = target.value.trim();
      pod.nameTouched = true;
      showAddress(form);
      clearError(form, "name");
      // A short pause after typing stops, then the format is checked (AC2).
      clearTimeout(podTimer);
      podTimer = setTimeout(() => form.isConnected && checkName(form, podUi()), 600);
    } else if (target.name === "email") {
      pod.email = target.value.trim();
      pod.emailTouched = true;
      clearError(form, "email");
    } else if (target.name === "pass" || target.name === "pass2") {
      clearError(form, target.name);
    }
  });
  step.addEventListener("focusout", (event) => {
    const form = podForm(event);
    if (!form) return;
    const name = (event.target as HTMLInputElement).name;
    // Leaving a field says what is wrong with it; leaving the first passphrase field says nothing about "Same again" yet.
    if (name === "name") {
      clearTimeout(podTimer);
      checkName(form, podUi());
    } else if (name === "email") checkEmail(form, podUi());
    else if (name === "pass") checkPass(form, podUi(), "pass");
    else if (name === "pass2") checkPass(form, podUi(), "pass2");
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
      clearTimeout(podTimer);
      observers.forEach((o) => o.disconnect());
    },
  };
}
