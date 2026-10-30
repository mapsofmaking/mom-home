import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderConceptCard,
  renderCheckpoint,
  mountCheckpoint,
  renderPhaseRail,
  renderEmptyState,
  renderError,
  renderPending,
  mountPending,
  renderProgress,
  setProgressQueue,
  setProgress,
  formatBytes,
  toast,
  esc,
} from "./patterns";
import {
  MAX_CHUNKS_PER_STEP,
  MAX_CHOICES,
  PENDING_DELAY_MS,
  PENDING_PATIENCE_MS,
  PROGRESS_CELLS,
  UNDO_WINDOW_MS,
} from "./ux";

/** Renders a markup string into a detached container for querying. */
function mount(markup: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = markup;
  document.body.appendChild(host);
  return host;
}

const chunk = (n: number) => ({ title: `Title ${n}`, body: `Body ${n}` });

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("esc", () => {
  it("neutralises markup in copy", () => {
    expect(esc('<img src=x onerror="alert(1)">')).not.toContain("<img");
  });
});

describe("renderConceptCard", () => {
  it("renders every chunk", () => {
    const host = mount(
      renderConceptCard({ title: "Your pod", chunks: [chunk(1), chunk(2), chunk(3)] })
    );
    expect(host.querySelectorAll(".concept-chunks > li")).toHaveLength(3);
  });

  it(`throws above ${MAX_CHUNKS_PER_STEP} chunks rather than truncating`, () => {
    // The rule is only real if it fails loudly. Silently dropping the fifth
    // chunk would lose authored copy and nobody would notice.
    const chunks = Array.from({ length: MAX_CHUNKS_PER_STEP + 1 }, (_, i) => chunk(i));

    expect(() => renderConceptCard({ title: "Too much", chunks })).toThrow(
      new RegExp(String(MAX_CHUNKS_PER_STEP))
    );
  });

  it(`allows exactly ${MAX_CHUNKS_PER_STEP}`, () => {
    const chunks = Array.from({ length: MAX_CHUNKS_PER_STEP }, (_, i) => chunk(i));
    expect(() => renderConceptCard({ title: "At the limit", chunks })).not.toThrow();
  });

  it("marks the icon decorative — the title carries the meaning", () => {
    const host = mount(
      renderConceptCard({ title: "T", chunks: [{ ...chunk(1), icon: "🔑" }] })
    );
    expect(host.querySelector(".concept-icon")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("escapes authored copy", () => {
    const host = mount(
      renderConceptCard({ title: "<script>x</script>", chunks: [chunk(1)] })
    );
    expect(host.querySelector("script")).toBeNull();
  });
});

describe("renderPhaseRail", () => {
  it("marks the current phase for assistive tech, not by colour alone", () => {
    const host = mount(renderPhaseRail(["Understand", "Set up", "Ready"], 1));

    const current = host.querySelector('[aria-current="step"]');
    expect(current?.textContent).toContain("Set up");
    // Each phase states its state in text, so the rail is not colour-only.
    expect(host.textContent).toContain("completed");
    expect(host.textContent).toContain("current step");
    expect(host.textContent).toContain("not started");
  });

  it("classes phases as done / current / todo", () => {
    const host = mount(renderPhaseRail(["a", "b", "c"], 1));
    const classes = [...host.querySelectorAll(".phase")].map((p) => p.className);
    expect(classes).toEqual([
      "phase is-done",
      "phase is-current",
      "phase is-todo",
    ]);
  });
});

describe("renderCheckpoint / mountCheckpoint", () => {
  const checkpoint = {
    question: "What is a pod?",
    options: [
      { label: "A public website", response: "Not quite — nothing is public by default." },
      { label: "My own locker", correct: true, response: "That's it." },
    ],
  };

  it(`throws above ${MAX_CHOICES} options`, () => {
    const options = Array.from({ length: MAX_CHOICES + 1 }, (_, i) => ({
      label: `Option ${i}`,
      response: "…",
    }));
    expect(() => renderCheckpoint({ question: "Too many?", options })).toThrow();
  });

  it("hides the response until an answer is chosen", () => {
    const host = mount(renderCheckpoint(checkpoint));
    expect(host.querySelector<HTMLElement>(".checkpoint-response")!.hidden).toBe(true);
  });

  it("explains a WRONG answer rather than just rejecting it", () => {
    const host = mount(renderCheckpoint(checkpoint));
    mountCheckpoint(host, checkpoint);

    host.querySelector<HTMLButtonElement>('[data-checkpoint-option="0"]')!.click();

    const response = host.querySelector<HTMLElement>(".checkpoint-response")!;
    expect(response.hidden).toBe(false);
    expect(response.textContent).toContain("nothing is public by default");
    // Not styled as correct — but not as a failure either.
    expect(response.classList.contains("is-correct")).toBe(false);
  });

  it("reports the correct answer", () => {
    const host = mount(renderCheckpoint(checkpoint));
    const answers: boolean[] = [];
    mountCheckpoint(host, checkpoint, (correct) => answers.push(correct));

    host.querySelector<HTMLButtonElement>('[data-checkpoint-option="1"]')!.click();

    expect(answers).toEqual([true]);
    expect(
      host.querySelector<HTMLElement>(".checkpoint-response")!.classList.contains("is-correct")
    ).toBe(true);
  });

  it("announces the response, which appears away from the focused button", () => {
    const host = mount(renderCheckpoint(checkpoint));
    mountCheckpoint(host, checkpoint);

    host.querySelector<HTMLButtonElement>('[data-checkpoint-option="1"]')!.click();

    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe("That's it.");
  });
});

describe("renderEmptyState", () => {
  it("names what belongs here and offers the action that creates it", () => {
    const host = mount(
      renderEmptyState({
        title: "Nothing here yet",
        body: "This is where your séances will appear.",
        action: { label: "Start the first one", id: "start" },
      })
    );

    expect(host.querySelector("h2")?.textContent).toBe("Nothing here yet");
    expect(host.querySelector("#start")?.textContent).toBe("Start the first one");
  });

  it("works without an action", () => {
    const host = mount(renderEmptyState({ title: "Empty", body: "Nothing to do here." }));
    expect(host.querySelector("button")).toBeNull();
  });
});

describe("renderError", () => {
  it("throws on an error state that offers no way forward", () => {
    // The rule that makes error states worth having. An error screen that only
    // announces the failure hands the person a dead end, and dead ends are what
    // gets remembered about an app.
    expect(() =>
      renderError({ title: "Could not load", detail: "Request failed (500) on /x." })
    ).toThrow(/no way forward/);
  });

  it("accepts a recovery sentence when no action can be offered", () => {
    const host = mount(
      renderError({
        title: "Your session ended",
        detail: "Access refused (401) on https://pod.example/private/.",
        recovery: "Signing in again will bring this back — nothing was lost.",
      })
    );

    expect(host.textContent).toContain("Signing in again");
    expect(host.querySelector("button")).toBeNull();
  });

  it("interrupts, because a failure cannot wait for a pause", () => {
    const host = mount(
      renderError({ title: "Offline", detail: "No response.", recovery: "Retry in a moment." })
    );
    expect(host.querySelector(".error-state")?.getAttribute("role")).toBe("alert");
  });

  it("keeps the raw failure behind a disclosure rather than on the screen", () => {
    const host = mount(
      renderError({
        title: "Could not save",
        detail: "Request failed (507) on https://pod.example/notes/.",
        action: { label: "Try again", id: "retry" },
        technical: '{"error":"insufficient storage"}',
      })
    );

    expect(host.querySelector("#retry")?.textContent).toBe("Try again");
    expect(host.querySelector("details.error-technical")?.textContent).toContain(
      "insufficient storage"
    );
  });

  it("escapes the failure text — server messages are not trusted markup", () => {
    const host = mount(
      renderError({
        title: "Failed",
        detail: "<img src=x onerror=alert(1)>",
        recovery: "Try again.",
      })
    );
    expect(host.querySelector("img")).toBeNull();
  });
});

describe("renderPending", () => {
  it("says what it is waiting for, and announces without stealing focus", () => {
    const host = mount(renderPending("Looking for your pod…"));

    expect(host.textContent).toContain("Looking for your pod…");
    expect(host.querySelector(".pending")?.getAttribute("role")).toBe("status");
    expect(host.querySelector(".pending-track")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("mountPending", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows nothing below the Doherty threshold", () => {
    const host = mount("");
    const stop = mountPending(host, "Looking for your pod…");

    vi.advanceTimersByTime(PENDING_DELAY_MS - 1);
    // A spinner that appears and vanishes inside 400ms reads as a glitch.
    expect(host.querySelector(".pending")).toBeNull();

    vi.advanceTimersByTime(2);
    expect(host.textContent).toContain("Looking for your pod…");
    stop();
  });

  it("stops cleanly before it ever shows — the fast path", () => {
    const host = mount("");
    mountPending(host, "Looking for your pod…")();

    vi.advanceTimersByTime(PENDING_DELAY_MS * 10);
    expect(host.querySelector(".pending")).toBeNull();
  });

  it("admits it is taking too long instead of looping in silence", () => {
    const host = mount("");
    const stop = mountPending(host, "Looking for your pod…", {
      patience: "Still looking — your provider may be slow to answer.",
    });

    vi.advanceTimersByTime(PENDING_PATIENCE_MS - 1);
    expect(host.textContent).toContain("Looking for your pod…");

    vi.advanceTimersByTime(2);
    expect(host.textContent).toContain("your provider may be slow");
    // Nobody is watching a status line by ten seconds in.
    expect(document.querySelector("[aria-live]")?.textContent).toContain("Still looking");
    stop();
  });

  it("does not escalate after it has been stopped", () => {
    const host = mount("");
    const stop = mountPending(host, "Looking…", { patience: "Still looking…" });

    vi.advanceTimersByTime(PENDING_DELAY_MS + 1);
    stop();
    vi.advanceTimersByTime(PENDING_PATIENCE_MS);

    expect(host.textContent).not.toContain("Still looking…");
  });
});

describe("toast", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the message and disappears after the undo window", () => {
    toast("Séance deleted.");

    expect(document.querySelector(".toast")?.textContent).toContain("Séance deleted.");

    vi.advanceTimersByTime(UNDO_WINDOW_MS + 1);
    expect(document.querySelector(".toast")).toBeNull();
  });

  it("runs undo and dismisses immediately", () => {
    const undo = vi.fn();
    toast("Deleted.", { undo });

    document.querySelector<HTMLButtonElement>(".toast-undo")!.click();

    expect(undo).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".toast")).toBeNull();
  });

  it("offers no undo button when there is nothing to undo", () => {
    toast("Saved.");
    expect(document.querySelector(".toast-undo")).toBeNull();
  });

  it("can be dismissed by hand before the window closes", () => {
    toast("Deleted.", { undo: () => {} });
    document.querySelector<HTMLButtonElement>(".toast-close")!.click();
    expect(document.querySelector(".toast")).toBeNull();
  });

  it("keeps only ONE toast — a stack is a second thing to manage", () => {
    toast("First.");
    toast("Second.");

    expect(document.querySelectorAll(".toast")).toHaveLength(1);
    expect(document.querySelector(".toast")?.textContent).toContain("Second.");
  });

  it("does not let a replaced toast's timer dismiss the new one", () => {
    toast("First.");
    vi.advanceTimersByTime(UNDO_WINDOW_MS - 100);
    toast("Second.");

    // The first toast's timer would fire here if it had not been cleared.
    vi.advanceTimersByTime(200);
    expect(document.querySelector(".toast")?.textContent).toContain("Second.");
  });

  it("escapes the message", () => {
    toast("<script>alert(1)</script>");
    expect(document.querySelector(".toast script")).toBeNull();
  });

  it("still dismisses a toast opened BY the undo callback", () => {
    // The timer is module-level: undo's own toast installed a new one, and the
    // dismiss that followed cleared it, leaving "Restored." on screen forever.
    toast("Deleted.", { undo: () => toast("Restored.") });
    document.querySelector<HTMLButtonElement>(".toast-undo")!.click();

    expect(document.querySelector(".toast")?.textContent).toContain("Restored.");

    vi.advanceTimersByTime(UNDO_WINDOW_MS + 1);
    expect(document.querySelector(".toast")).toBeNull();
  });
});

describe("progress", () => {
  const block = () => mount(renderProgress("This file, sent")).querySelector<HTMLElement>(".progress")!;

  it("starts hidden, with a cell per PROGRESS_CELLS", () => {
    const p = block();
    expect(p.hidden).toBe(true);
    expect(p.querySelectorAll(".progress-cells i")).toHaveLength(PROGRESS_CELLS);
    expect(p.querySelector(".progress-meter")!.getAttribute("role")).toBe("progressbar");
  });

  it("fills the cells and says the share and the amount", () => {
    const p = block();
    setProgress(p, 4.1 * 1024 * 1024, 5.7 * 1024 * 1024);
    expect(p.querySelector(".progress-value")!.textContent).toBe("71%");
    expect(p.querySelectorAll(".progress-cells i.is-on")).toHaveLength(Math.floor((71 * PROGRESS_CELLS) / 100));
    expect(p.querySelector(".progress-amount")!.textContent).toBe("4.1 MB of 5.7 MB");
    expect(p.querySelector(".progress-meter")!.getAttribute("aria-valuenow")).toBe("71");
  });

  it("never claims more than all of it", () => {
    const p = block();
    setProgress(p, 120, 100);
    expect(p.querySelector(".progress-value")!.textContent).toBe("100%");
    setProgress(p, 0, 0);
    expect(p.querySelector(".progress-value")!.textContent).toBe("0%");
  });

  it("names the item so its extension stays in view, and as text only", () => {
    const p = block();
    setProgressQueue(p, "Uploading 2 of 5", "Évolution_d_OpenFab.png");
    const line = p.querySelector(".progress-queue")!;
    expect(line.textContent).toBe("Uploading 2 of 5 ·\u00a0Évolution_d_OpenFab.png");
    // Only the stem shrinks with an ellipsis; the extension is its own span.
    expect(line.querySelector(".progress-stem")!.textContent).toBe("Évolution_d_OpenFab");
    expect(line.querySelector(".progress-name")!.lastElementChild!.textContent).toBe(".png");
    setProgressQueue(p, "Uploading 1 of 1", "<img src=x onerror=alert(1)>.md");
    expect(line.querySelector("img")).toBeNull();
    setProgressQueue(p, "Copying to Markdown");
    expect(line.textContent).toBe("Copying to Markdown");
  });

  it("writes sizes with one decimal", () => {
    expect([512, 204 * 1024, 4.1 * 1024 * 1024, 3 * 1024 ** 3].map(formatBytes)).toEqual([
      "512 bytes",
      "204.0 kB",
      "4.1 MB",
      "3.0 GB",
    ]);
  });
});
