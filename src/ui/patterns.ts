/**
 * The UX patterns these apps have converged on, as components.
 *
 * Tier 2 of how preferences get set (see `./ux.ts`): a principle you import
 * cannot be violated by accident. "At most four chunks" written in a document
 * is a hope; `renderConceptCard` throwing at five is a rule.
 *
 * Every function here returns an HTML string, matching how the rest of the kit
 * renders. The two that need behaviour (`mountCheckpoint`, `toast`) take a
 * container and wire themselves.
 */
import {
  MAX_CHOICES,
  MAX_CHUNKS_PER_STEP,
  PENDING_DELAY_MS,
  PENDING_PATIENCE_MS,
  PROGRESS_CELLS,
  UNDO_WINDOW_MS,
} from "./ux";
import { announce } from "./a11y";

/**
 * Escapes text before it goes into innerHTML.
 *
 * Quotes are escaped too, which `textContent` alone does not do — several
 * patterns here interpolate into an attribute (`id="${esc(...)}"`), and a
 * function named `esc` that is only safe in element content is a trap.
 */
export function esc(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ── Concept card ─────────────────────────────────────────────────────────── */

export interface Chunk {
  /** One short glyph or emoji. Decorative — the title carries the meaning. */
  icon?: string;
  title: string;
  body: string;
}

export interface ConceptCard {
  /** Self-numbering context, e.g. "Idea 2 of 3 · Who you are". */
  kicker?: string;
  title: string;
  /** At most MAX_CHUNKS_PER_STEP. More throws — see below. */
  chunks: Chunk[];
  /** One concrete artefact for the chunk that needs it: a sample WebID, a path. */
  aside?: string;
}

/**
 * A single explanatory step.
 *
 * Throws above `MAX_CHUNKS_PER_STEP` rather than truncating: dropping a chunk
 * silently would lose authored content, while throwing surfaces the decision
 * the first time the screen is opened — split the step, or cut something.
 * Chunks are authored copy, not user data, so this fails during development.
 */
export function renderConceptCard(card: ConceptCard): string {
  if (card.chunks.length > MAX_CHUNKS_PER_STEP) {
    throw new Error(
      `Concept "${card.title}" has ${card.chunks.length} chunks; the limit is ` +
        `${MAX_CHUNKS_PER_STEP}. Split the step rather than raising the limit — ` +
        `see src/ui/ux.ts.`
    );
  }

  return `
    <article class="concept">
      ${card.kicker ? `<p class="label-mono">${esc(card.kicker)}</p>` : ""}
      <h2>${esc(card.title)}</h2>
      <ul class="concept-chunks">
        ${card.chunks
          .map(
            (chunk) => `
          <li>
            ${chunk.icon ? `<span class="concept-icon" aria-hidden="true">${esc(chunk.icon)}</span>` : ""}
            <div>
              <p class="concept-chunk-title">${esc(chunk.title)}</p>
              <p class="concept-chunk-body">${esc(chunk.body)}</p>
            </div>
          </li>`
          )
          .join("")}
      </ul>
      ${card.aside ? `<p class="concept-aside"><code>${esc(card.aside)}</code></p>` : ""}
    </article>`;
}

/* ── Phase rail ───────────────────────────────────────────────────────────── */

/**
 * Progress shown as a few phases rather than a step count.
 *
 * Ten steps shown as "4 of 10" reads as a wall; the same ten grouped into three
 * named phases reads as nearly done with the first. Goal-gradient: people push
 * harder when the end of the *current* segment is visible.
 *
 * `current` is the index of the active phase, not the step.
 */
export function renderPhaseRail(phases: string[], current: number): string {
  return `
    <nav class="phase-rail" aria-label="Progress">
      <ol>
        ${phases
          .map((phase, i) => {
            const state = i < current ? "done" : i === current ? "current" : "todo";
            // The state is in the text for assistive tech, not colour alone.
            const label =
              state === "done" ? "completed" : state === "current" ? "current step" : "not started";
            return `
          <li class="phase is-${state}" ${state === "current" ? 'aria-current="step"' : ""}>
            <span class="phase-bar"></span>
            <span class="phase-name">${esc(phase)}</span>
            <span class="visually-hidden">(${label})</span>
          </li>`;
          })
          .join("")}
      </ol>
    </nav>`;
}

/* ── Comprehension checkpoint ─────────────────────────────────────────────── */

export interface CheckpointOption {
  label: string;
  correct?: boolean;
  /** Shown after choosing — explain why, for the wrong answers too. */
  response: string;
}

export interface Checkpoint {
  question: string;
  options: CheckpointOption[];
}

/**
 * A phase boundary that asks whether the explanation landed.
 *
 * The point is that it is not a counter: a "Next" button measures scrolling,
 * this measures understanding, and it is the cheapest honest signal available.
 * Getting it wrong is not a failure state — the response explains, and the
 * reader moves on.
 */
export function renderCheckpoint(checkpoint: Checkpoint): string {
  if (checkpoint.options.length > MAX_CHOICES) {
    throw new Error(
      `Checkpoint "${checkpoint.question}" offers ${checkpoint.options.length} options; ` +
        `the limit is ${MAX_CHOICES}. See src/ui/ux.ts.`
    );
  }

  return `
    <section class="checkpoint">
      <p class="label-mono">One quick check</p>
      <h2>${esc(checkpoint.question)}</h2>
      <div class="checkpoint-options">
        ${checkpoint.options
          .map(
            (option, i) => `
          <button class="ghost" data-checkpoint-option="${i}">${esc(option.label)}</button>`
          )
          .join("")}
      </div>
      <p class="checkpoint-response" hidden></p>
    </section>`;
}

/** Wires a rendered checkpoint. `onAnswer` fires with whether it was right. */
export function mountCheckpoint(
  container: HTMLElement,
  checkpoint: Checkpoint,
  onAnswer?: (correct: boolean) => void
): void {
  const response = container.querySelector<HTMLElement>(".checkpoint-response");
  if (!response) return;

  container.querySelectorAll<HTMLButtonElement>("[data-checkpoint-option]").forEach((button) => {
    button.addEventListener("click", () => {
      const option = checkpoint.options[Number(button.dataset.checkpointOption)];

      response.textContent = option.response;
      response.hidden = false;
      response.classList.toggle("is-correct", Boolean(option.correct));
      // Announced as well as shown: the response appears below the buttons and
      // focus stays on the button, so nothing would otherwise read it out.
      announce(option.response);

      container
        .querySelectorAll<HTMLButtonElement>("[data-checkpoint-option]")
        .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));

      onAnswer?.(Boolean(option.correct));
    });
  });
}

/* ── Empty state ──────────────────────────────────────────────────────────── */

export interface EmptyState {
  title: string;
  /** One line. Say what would be here and how it gets here. */
  body: string;
  action?: { label: string; id: string };
}

/**
 * What a person sees the first time — usually before they see anything else.
 *
 * A pod starts empty, so this is the real first screen of every app built on
 * the kit, and "nothing here" is the least useful thing it could say. Name what
 * belongs here, and offer the one action that creates it.
 */
export function renderEmptyState(state: EmptyState): string {
  return `
    <div class="empty-state">
      <h2>${esc(state.title)}</h2>
      <p class="lead">${esc(state.body)}</p>
      ${state.action ? `<p><button id="${esc(state.action.id)}">${esc(state.action.label)}</button></p>` : ""}
    </div>`;
}

/* ── Error state ──────────────────────────────────────────────────────────── */

export interface ErrorState {
  /** What failed, in the user's terms. Not "Error" and not a status code. */
  title: string;
  /**
   * What happened and which resource refused. `describePodError` from
   * `lib/pod.ts` produces exactly this line — pass it straight through.
   */
  detail: string;
  /** The way forward. A retry, a re-sign-in, a way back to somewhere that works. */
  action?: { label: string; id: string };
  /**
   * Why there is no action, when there genuinely is none. Required in that
   * case — see `renderError`.
   */
  recovery?: string;
  /**
   * The raw failure, behind a disclosure. Progressive disclosure applies to
   * errors too: the plain sentence first, the server's own words on demand for
   * whoever is going to file the bug.
   */
  technical?: string;
}

/**
 * A failure the person can act on.
 *
 * Error states decide long-term trust more than success states do: a success
 * path is forgotten the moment it works, while a dead end is remembered, and
 * on a pod app failures are *routine* — an expired token, a pod that moved, a
 * provider that is down. None of those are the user's mistake, and all of them
 * are the moment they decide whether this thing is trustworthy.
 *
 * So the rule is acknowledgment plus a way forward, and it is enforced rather
 * than asked for: **throws when there is neither an `action` nor a `recovery`
 * sentence.** An error screen that only announces the failure hands the person
 * a dead end and makes it their problem. If nothing can be retried, say so in
 * `recovery` — "your session ended; signing in again will bring this back" is
 * a way forward even when no button can be offered.
 *
 * `role="alert"` because a failure interrupts: it is the one thing on the
 * screen that must not wait for a pause in the reading order.
 */
export function renderError(state: ErrorState): string {
  if (!state.action && !state.recovery) {
    throw new Error(
      `Error state "${state.title}" offers no way forward. Give it an action, or ` +
        `a recovery sentence saying why there is none — see src/ui/ux.ts. An error ` +
        `that only announces the failure makes it the user's problem.`
    );
  }

  return `
    <div class="error-state" role="alert">
      <h2>${esc(state.title)}</h2>
      <p class="error">${esc(state.detail)}</p>
      ${state.recovery ? `<p class="lead">${esc(state.recovery)}</p>` : ""}
      ${
        state.action
          ? `<p><button id="${esc(state.action.id)}">${esc(state.action.label)}</button></p>`
          : ""
      }
      ${
        state.technical
          ? `<details class="error-technical">
               <summary>What the server said</summary>
               <pre><code>${esc(state.technical)}</code></pre>
             </details>`
          : ""
      }
    </div>`;
}

/* ── Pending ──────────────────────────────────────────────────────────────── */

/**
 * Waiting on the network — which, for a pod app, is most first loads.
 *
 * Says what is being waited for rather than spinning anonymously: "Looking for
 * your pod" is diagnosable when it hangs, a bare spinner is not. Phrased as
 * looking rather than finding, because it may not find it — a status line that
 * assumes success is the same dishonesty as an error with no way forward.
 *
 * The indicator is a travelling line rather than a rotating spinner. A rotation
 * has no start and no end, so after a few seconds it stops reading as progress
 * and starts reading as frozen; a line that crosses and restarts keeps saying
 * "still working" without ever claiming to know how far along it is.
 *
 * `role="status"` announces it without stealing focus.
 */
export function renderPending(message: string): string {
  return `
    <div class="pending" role="status">
      <span>${esc(message)}</span>
      <span class="pending-track" aria-hidden="true"><span class="pending-line"></span></span>
    </div>`;
}

/**
 * A pending state that respects both ends of the wait.
 *
 * Two thresholds, and both exist because an indeterminate wait misleads at
 * either extreme:
 *
 *   - Under `PENDING_DELAY_MS` nothing is shown at all. A spinner that appears
 *     and vanishes inside 200ms is read as a glitch, and most warm pod reads
 *     land there.
 *   - After `PENDING_PATIENCE_MS` the message is replaced by `patience` — a
 *     line that admits this is taking too long. Looping the same indicator
 *     indefinitely tells a person nothing they cannot already see.
 *
 * Returns a `stop` function. Call it when the work settles, whether it
 * succeeded or failed — leaving it running is how a screen ends up claiming to
 * be loading something that already failed.
 */
export function mountPending(
  container: HTMLElement,
  message: string,
  options: { patience?: string; delayMs?: number; patienceMs?: number } = {}
): () => void {
  const {
    patience,
    delayMs = PENDING_DELAY_MS,
    patienceMs = PENDING_PATIENCE_MS,
  } = options;

  const timers: number[] = [];

  timers.push(
    window.setTimeout(() => {
      container.innerHTML = renderPending(message);

      if (patience) {
        timers.push(
          window.setTimeout(() => {
            const line = container.querySelector(".pending span");
            if (line) line.textContent = patience;
            // Announced as well as swapped: the change is a single line of text
            // in a region nobody is looking at by this point.
            announce(patience);
          }, patienceMs - delayMs)
        );
      }
    }, delayMs)
  );

  return () => timers.forEach((t) => clearTimeout(t));
}

/* ── Undo toast ───────────────────────────────────────────────────────────── */

let toastTimer: number | undefined;

/* ── Progress ───────────────────────────────────────────────────────────── */

/**
 * Work that can be measured, said in two lines: the queue, then the item.
 *
 * Line 1 is the queue ("Uploading 2 of 5 · name"), a `.hint`, set once per
 * item so a screen reader hears it once, not at every byte. Line 2 is the item
 * being worked on: cells filling in sage, the share in bold, the amount in the
 * quiet tone. A single item is a queue of one. Both lines used to be built
 * separately, one round after the other, and stacked as two blocks competing
 * for the same glance; one block with one job per line is what that taught.
 *
 * Where the wait cannot be measured, use `renderPending` instead: cells that
 * never move are worse than a line that admits it does not know.
 *
 * Starts hidden; `setProgressQueue` and `setProgress` fill it, and the caller
 * shows and hides the block (`hidden`). The block keeps its height while it
 * shows, so what is under it does not jump.
 */
export function renderProgress(label: string): string {
  return `
    <div class="progress" hidden>
      <p class="hint progress-queue" role="status"></p>
      <div class="progress-meter" role="progressbar" aria-label="${esc(label)}"
           aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <span class="progress-cells" aria-hidden="true">${"<i></i>".repeat(PROGRESS_CELLS)}</span>
        <strong class="progress-value">0%</strong><span class="progress-amount"></span>
      </div>
    </div>`;
}

/**
 * Line 1: "Uploading 2 of 5 · Évolution_d_OpenFab.png". A long name is cut in
 * the middle, never at the end, so its extension stays in view: the stem
 * shrinks with an ellipsis, the extension does not. Built as text, because a
 * file name is an input.
 */
export function setProgressQueue(progress: HTMLElement, what: string, name = ""): void {
  const line = progress.querySelector<HTMLElement>(".progress-queue");
  if (!line) return;
  line.replaceChildren();
  const lead = document.createElement("span");
  // A no-break space: a flex row drops a plain trailing one.
  lead.textContent = name ? `${what} ·\u00a0` : what;
  line.append(lead);
  if (!name) return;
  const dot = name.lastIndexOf(".");
  const stem = document.createElement("span");
  stem.className = "progress-stem";
  stem.textContent = dot > 0 ? name.slice(0, dot) : name;
  const ext = document.createElement("span");
  ext.textContent = dot > 0 ? name.slice(dot) : "";
  const whole = document.createElement("span");
  whole.className = "progress-name";
  whole.title = name;
  whole.append(stem, ext);
  line.append(whole);
}

/** Line 2: `done` of `total` bytes. Hidden while there is nothing to measure. */
export function setProgress(progress: HTMLElement, done: number, total: number): void {
  const meter = progress.querySelector<HTMLElement>(".progress-meter");
  if (!meter) return;
  const share = total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0;
  const on = Math.floor((share * PROGRESS_CELLS) / 100);
  meter.querySelectorAll(".progress-cells i").forEach((cell, i) => cell.classList.toggle("is-on", i < on));
  meter.querySelector(".progress-value")!.textContent = `${share}%`;
  meter.querySelector(".progress-amount")!.textContent = `${formatBytes(done)} of ${formatBytes(total)}`;
  meter.setAttribute("aria-valuenow", String(share));
}

/** "512 bytes", "204.0 kB", "4.1 MB": one decimal, so the digits do not jump. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/**
 * The mechanism behind "reversible everywhere".
 *
 * Reversibility is the principle that lets every other one relax: a person who
 * knows they can undo will try things, and an app whose actions are all
 * reversible needs far fewer confirmation dialogs. That trade only works if
 * undoing is genuinely easy, which is what this is for.
 *
 * One toast at a time — a stack of them is a second thing to manage at exactly
 * the moment attention is elsewhere. A new toast replaces the old, running the
 * previous one's `onDismiss` so nothing is left half-finished.
 */
export function toast(
  message: string,
  options: { undo?: () => void; durationMs?: number; onDismiss?: () => void } = {}
): void {
  const { undo, durationMs = UNDO_WINDOW_MS, onDismiss } = options;

  document.querySelector(".toast")?.remove();
  if (toastTimer !== undefined) clearTimeout(toastTimer);

  const el = document.createElement("div");
  el.className = "toast";
  // assertive, not polite: this carries a time-limited action, so it has to
  // interrupt rather than wait for a pause.
  el.setAttribute("role", "alert");
  el.innerHTML = `
    <span class="toast-message">${esc(message)}</span>
    ${undo ? `<button class="toast-undo ghost">Undo</button>` : ""}
    <button class="toast-close ghost" aria-label="Dismiss">✕</button>`;

  const dismiss = () => {
    // Only clear the timer if it is still *this* toast's. An `undo` callback
    // that shows its own confirmation toast ("Restored.") installs a new timer
    // before this runs; clearing that one left the replacement on screen
    // forever, which is the opposite of the "one toast at a time" rule.
    if (timer !== undefined && toastTimer === timer) clearTimeout(toastTimer);
    el.remove();
    onDismiss?.();
  };

  el.querySelector(".toast-undo")?.addEventListener("click", () => {
    // Dismissed before `undo` runs, for the same reason: undo may open the
    // next toast, and this one must be gone by then.
    dismiss();
    undo?.();
  });
  el.querySelector(".toast-close")?.addEventListener("click", dismiss);

  document.body.appendChild(el);
  const timer = window.setTimeout(dismiss, durationMs);
  toastTimer = timer;
}
