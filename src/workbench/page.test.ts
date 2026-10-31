import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseTree } from "../tree/parse";
import { renderPage, type PageOptions } from "./page";

const tree = parseTree(readFileSync(join(__dirname, "../../public/onboarding.ttl"), "utf8"));

let observers: { disconnect: ReturnType<typeof vi.fn> }[] = [];
let mediaListeners = 0;

beforeEach(() => {
  observers = [];
  mediaListeners = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect = vi.fn();
      observe() {}
      constructor() {
        observers.push(this);
      }
    }
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: (_t: string, _l: unknown, o?: { signal?: AbortSignal }) => {
      mediaListeners++;
      o?.signal?.addEventListener("abort", () => mediaListeners--);
    },
  }));
});

const options = (mode: PageOptions["mode"], done = new Set<string>()): PageOptions => ({
  mode,
  who: "Atelier",
  done,
  draft: {},
  fold: { folded: false },
  onSignIn: () => {},
  onSignOut: () => {},
});

const submit = (root: HTMLElement) => {
  root.querySelector<HTMLInputElement>("#f-name")!.value = "Atelier";
  root.querySelector<HTMLInputElement>("#f-city")!.value = "Anderlecht";
  // The pin, as where.ts leaves it in the form.
  for (const [name, v] of [["lat", "50.84"], ["lon", "4.33"], ["country", "BE"]]) {
    (root.querySelector("form")!.elements.namedItem(name) as HTMLInputElement).value = v;
  }
  root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
};

describe("renderPage", () => {
  it("undoes its observers and listeners on destroy, so a redraw never stacks them", () => {
    const root = document.createElement("div");
    const page = renderPage(root, tree, options("onboarding"));
    expect(observers).toHaveLength(2);
    expect(mediaListeners).toBe(1);
    page.destroy();
    expect(observers.every((o) => o.disconnect.mock.calls.length === 1)).toBe(true);
    expect(mediaListeners).toBe(0);
  });

  it("signed out, tile A's form marks it done in this tab", () => {
    const root = document.createElement("div");
    const done = new Set<string>();
    renderPage(root, tree, options("onboarding", done));
    submit(root);
    expect(done.has("describe")).toBe(true);
  });

  it("signed out, the card's way on takes the focus", () => {
    const root = document.createElement("div");
    document.body.append(root);
    renderPage(root, tree, options("onboarding", new Set<string>()));
    submit(root);
    expect(document.activeElement).toBe(root.querySelector('[data-go="keep"]'));
    root.remove();
  });

  it("signed out, tile A's form without a city draws no card and goes to the city", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const done = new Set<string>();
    renderPage(root, tree, options("onboarding", done));
    root.querySelector<HTMLInputElement>("#f-name")!.value = "Atelier";
    root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    expect(done.size).toBe(0);
    expect(document.activeElement).toBe(root.querySelector("#f-city"));
    root.remove();
  });

  it("signed in, tile A's form never marks anything done: the pod is the map (AC4)", () => {
    const root = document.createElement("div");
    const done = new Set<string>();
    renderPage(root, tree, options("workbench", done));
    submit(root);
    expect(done.size).toBe(0);
  });

  it("selects a reached tile, never fog, when nothing is open", () => {
    const root = document.createElement("div");
    const everything = new Set(tree.tiles.map((t) => t.id));
    renderPage(root, tree, options("onboarding", everything));
    expect(root.querySelector('[aria-current="step"]')).not.toBeNull();
    expect(root.querySelector(".wb-step-title")!.textContent).not.toBe("Still to discover");
  });
});
