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

describe("renderPage keeps the draft (14.2 AC7)", () => {
  const type = (root: HTMLElement, name: string, value: string) => {
    const input = root.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  it("signed out, every edit goes to the shell", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const onDraft = vi.fn();
    renderPage(root, tree, { ...options("onboarding"), onDraft });
    type(root, "name", "Weld Done");
    expect(onDraft).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Weld Done" }));
    root.remove();
  });

  it("signed in, nothing is kept: tile A isn't on the pod yet", () => {
    const root = document.createElement("div");
    const onDraft = vi.fn();
    renderPage(root, tree, { ...options("workbench"), onDraft });
    type(root, "name", "Weld Done");
    expect(onDraft).not.toHaveBeenCalled();
  });

  it("Start over asks in the page, then clears the draft and the card", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const draft = { name: "Weld Done", city: "Marolles" };
    const done = new Set<string>();
    const onDraft = vi.fn();
    renderPage(root, tree, { ...options("onboarding", done), draft, onDraft });
    const click = (id: string) => root.querySelector<HTMLButtonElement>(`#${id}`)!.click();
    click("start-over");
    expect(root.querySelector<HTMLElement>("#start-over-confirm")!.hidden).toBe(false);
    expect(document.activeElement).toBe(root.querySelector("#clear-yes"));
    click("clear-no");
    expect(root.querySelector<HTMLElement>("#start-over-confirm")!.hidden).toBe(true);
    expect(draft).toEqual({ name: "Weld Done", city: "Marolles" });
    click("start-over");
    click("clear-yes");
    expect(draft).toEqual({});
    expect(onDraft).toHaveBeenLastCalledWith({});
    expect(root.querySelector<HTMLInputElement>("#f-name")!.value).toBe("");
    expect(document.activeElement).toBe(root.querySelector("#f-name"));
    root.remove();
  });
});

describe("renderPage, review fixes (14.2)", () => {
  it("a geocoder answer that lands after Start over doesn't bring the draft back", async () => {
    const { timing } = await import("./where");
    Object.assign(timing, { minWait: 0, retryGap: 0, tick: 0 });
    let answer!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => (answer = r))));
    const root = document.createElement("div");
    document.body.append(root);
    const draft: Record<string, string> = {};
    const onDraft = vi.fn();
    renderPage(root, tree, { ...options("onboarding"), draft, onDraft });
    const city = root.querySelector<HTMLInputElement>("#f-city")!;
    root.querySelector<HTMLInputElement>("#f-name")!.value = "Weld Done";
    city.value = "Marolles";
    city.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    root.querySelector<HTMLButtonElement>("#start-over")!.click();
    root.querySelector<HTMLButtonElement>("#clear-yes")!.click();
    answer(Response.json({ lat: 50.8, lon: 4.3, country_code: "be", postcode: "1000", display_name: "Marolles, Bruxelles" }));
    await new Promise((r) => setTimeout(r, 10));
    expect(draft).toEqual({});
    expect(onDraft).toHaveBeenLastCalledWith({});
    root.remove();
    vi.unstubAllGlobals();
  });

  it("a draft with a town and no pin asks the geocoder when the page opens (forwarded from genjson, 14.8)", async () => {
    const { timing } = await import("./where");
    Object.assign(timing, { minWait: 0, retryGap: 0, tick: 0 });
    const fetchMock = vi.fn(async () =>
      Response.json({ lat: 50.8, lon: 4.3, country_code: "be", postcode: "1000", display_name: "Marolles, Bruxelles" })
    );
    vi.stubGlobal("fetch", fetchMock);
    const root = document.createElement("div");
    document.body.append(root);
    const draft: Record<string, string> = { name: "Weld Done", street: "Rue Haute 12", city: "Bruxelles" };
    renderPage(root, tree, { ...options("onboarding"), draft });
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(draft.lat).toBe("50.8");
    expect(draft.country).toBe("BE");
    root.remove();
    vi.unstubAllGlobals();
  });

  it("a draft that already has its pin doesn't ask again", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const root = document.createElement("div");
    document.body.append(root);
    const draft = { name: "Weld Done", city: "Bruxelles", lat: "50.8", lon: "4.3", country: "BE", place: "Marolles" };
    renderPage(root, tree, { ...options("onboarding"), draft });
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
    root.remove();
    vi.unstubAllGlobals();
  });

  it("tidies the field Enter submitted from", () => {
    const root = document.createElement("div");
    const draft: Record<string, string> = {};
    renderPage(root, tree, { ...options("onboarding"), draft });
    root.querySelector<HTMLInputElement>("#f-logo")!.value = "welddone.example/logo.png";
    submit(root);
    expect(draft.logo).toBe("https://welddone.example/logo.png");
  });
});
