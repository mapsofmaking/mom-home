import { describe, it, expect, beforeEach } from "vitest";
import { focusView, announce, trackInputModality } from "./a11y";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("focusView", () => {
  it("moves focus to the view's heading so the change is announced", () => {
    // The bug this exists for: replacing innerHTML destroys the focused
    // element and the browser silently resets focus to the document root.
    document.body.innerHTML = `
      <div id="app"><main><h1>Connected</h1><button>Sign out</button></main></div>`;
    const app = document.querySelector<HTMLElement>("#app")!;

    focusView(app);

    expect(document.activeElement?.tagName).toBe("H1");
    expect(document.activeElement?.textContent).toBe("Connected");
  });

  it("makes the heading focusable without putting it in the tab order", () => {
    document.body.innerHTML = `<div id="app"><h1>Title</h1></div>`;
    const app = document.querySelector<HTMLElement>("#app")!;

    focusView(app);

    expect(app.querySelector("h1")!.getAttribute("tabindex")).toBe("-1");
  });

  it("uses a data-view-title when there is no visible heading", () => {
    document.body.innerHTML = `
      <div id="app"><span data-view-title>Connecting</span><p>…</p></div>`;
    const app = document.querySelector<HTMLElement>("#app")!;

    focusView(app);

    expect(document.activeElement?.getAttribute("data-view-title")).not.toBeNull();
  });

  it("falls back to the container rather than doing nothing", () => {
    document.body.innerHTML = `<div id="app"><p>No heading here.</p></div>`;
    const app = document.querySelector<HTMLElement>("#app")!;

    focusView(app);

    expect(document.activeElement).toBe(app);
  });

  it("respects a tabindex the view already set", () => {
    document.body.innerHTML = `<div id="app"><h1 tabindex="0">Title</h1></div>`;
    const app = document.querySelector<HTMLElement>("#app")!;

    focusView(app);

    expect(app.querySelector("h1")!.getAttribute("tabindex")).toBe("0");
  });
});

describe("announce", () => {
  it("puts the message in a polite live region", () => {
    announce("Saved.");

    const region = document.querySelector('[aria-live="polite"]');
    expect(region?.getAttribute("role")).toBe("status");
    expect(region?.textContent).toBe("Saved.");
  });

  it("reuses one region rather than creating one per message", () => {
    // A region created and filled in the same frame is frequently missed by
    // assistive tech, which has to be observing it beforehand.
    announce("First.");
    announce("Second.");

    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe("Second.");
  });

  it("re-announces an identical message", () => {
    announce("Saved.");
    const region = document.querySelector('[aria-live="polite"]')!;
    region.textContent = "Saved.";

    announce("Saved.");

    // Cleared then re-set, so the region's content genuinely changed and the
    // repeat is spoken instead of being swallowed as "no change".
    expect(region.textContent).toBe("Saved.");
  });

  it("is invisible on screen but present in the accessibility tree", () => {
    announce("Saved.");
    const region = document.querySelector('[aria-live="polite"]')!;
    // Not display:none / hidden, which would remove it from the tree entirely.
    expect(region.className).toBe("visually-hidden");
    expect(region.hasAttribute("hidden")).toBe(false);
  });
});

describe("trackInputModality", () => {
  it("starts as pointer and follows the last input", () => {
    const root = document.createElement("div");
    trackInputModality(root);
    expect(root.dataset.input).toBe("pointer");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(root.dataset.input).toBe("keyboard");
    document.dispatchEvent(new Event("pointerdown"));
    expect(root.dataset.input).toBe("pointer");
  });
});
