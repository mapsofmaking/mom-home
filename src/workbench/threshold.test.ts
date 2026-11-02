import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Offers } from "../lib/provider";
import { parseTree } from "../tree/parse";
import { renderPage, type PageOptions } from "./page";
import { renderThreshold, type Door } from "./threshold";

const tree = parseTree(readFileSync(join(__dirname, "../../public/onboarding.ttl"), "utf8"));
const keep = tree.tiles.find((t) => t.id === "keep")!;
const html = (s: string) => {
  const d = document.createElement("div");
  d.innerHTML = s;
  return d;
};
/** A threshold context with the parts a test doesn't care about filled in. */
const ctx = (c: { offers: Offers | null; door: Door | null }) => ({ ...c, draft: {}, pod: { name: "weld-done", email: "", nameTouched: false, emailTouched: false } });
const doors = (d: HTMLElement) => [...d.querySelectorAll<HTMLElement>("[data-door]")].map((b) => b.dataset.door);

describe("tile B's threshold (14.3 AC1, AC4)", () => {
  it("offers two doors of the same weight, and no badge (bible §3)", () => {
    const d = html(renderThreshold(keep, ctx({ offers: "open", door: null })));
    expect(doors(d)).toEqual(["self", "pod"]);
    const [self, pod] = [...d.querySelectorAll<HTMLElement>("[data-door]")];
    expect(self.className).toBe(pod.className);
    expect(self.className).not.toContain("primary");
    expect(d.querySelector(".status-label")).toBeNull();
    expect(d.querySelector("[autofocus]")).toBeNull();
    expect(self.querySelector(".wb-door-title")!.textContent).toBe(keep.ui.uiDoorSelf);
    expect(pod.querySelector(".wb-door-title")!.textContent).toBe(keep.ui.uiDoorPod);
  });

  it("uses the design system's door parts: title, what it means, where the file lives (storyboard B1)", () => {
    const d = html(renderThreshold(keep, ctx({ offers: "open", door: null })));
    const [self, pod] = [...d.querySelectorAll<HTMLElement>("[data-door]")];
    expect(self.querySelector(".wb-door-desc")!.textContent).toBe(keep.ui.uiDoorSelfDesc);
    expect(self.querySelector(".wb-door-where")!.textContent).toBe(keep.ui.uiDoorSelfWhere);
    expect(pod.querySelector(".wb-door-desc")!.textContent).toBe(keep.ui.uiDoorPodDesc);
    // The pod door says where the pod would live, from the description.
    expect(pod.querySelector(".wb-door-where")!.textContent).toBe("weld-done.pod.mapsofmaking.org");
    expect(d.textContent).toContain(keep.ui.uiDoorsNote);
  });

  it("says Bernard's line, then offers a real 'not now' as the one way out", () => {
    const d = html(renderThreshold(keep, ctx({ offers: "open", door: null })));
    expect(d.querySelector(".bernard-voice")!.textContent).toBe(`— ${keep.lines.say}`);
    expect(d.querySelector("#not-now")!.textContent).toBe(keep.ui.uiNotNow);
  });

  it("'not now' answers in place and offers the way back; nothing is sent", () => {
    const d = html(renderThreshold(keep, ctx({ offers: "open", door: "notnow" })));
    expect(d.querySelector("#reply")!.textContent).toContain("Nothing was sent.");
    expect(d.querySelector("#not-now")).toBeNull();
    expect(d.querySelector("#doors-again")!.textContent).toBe(keep.ui.uiDoorsAgain);
  });

  it("holds the pod door back, disabled, while the server is being asked", () => {
    const d = html(renderThreshold(keep, ctx({ offers: null, door: null })));
    expect(d.querySelector<HTMLButtonElement>('[data-door="pod"]')!.disabled).toBe(true);
    expect(d.querySelector('[data-door="self"]')!.hasAttribute("disabled")).toBe(false);
  });

  it("says before any door that the server takes no accounts, and leaves the self-host door", () => {
    const d = html(renderThreshold(keep, ctx({ offers: "closed", door: null })));
    expect(d.textContent).toContain(keep.ui.uiNoRegister);
    expect(doors(d)).toEqual(["self"]);
  });

  it("when the server can't be reached, says so, offers 'try again', and doesn't say it refuses", () => {
    const d = html(renderThreshold(keep, ctx({ offers: "down", door: null })));
    expect(d.textContent).toContain(keep.ui.uiProviderDown);
    expect(d.textContent).not.toContain(keep.ui.uiNoRegister);
    expect(d.querySelector("#offers-retry")).not.toBeNull();
    expect(doors(d)).toEqual(["self"]);
  });

  it("the pod door opens its form only when the server takes accounts", () => {
    const open = html(renderThreshold(keep, ctx({ offers: "open", door: "pod" })));
    expect(open.querySelector("#f-pod")).not.toBeNull();
    expect(open.querySelector(".bernard-voice")!.textContent).toBe(`— ${keep.lines.sayPod}`);
    for (const offers of ["closed", "down", null] as const) {
      expect(html(renderThreshold(keep, ctx({ offers, door: "pod" }))).querySelector("#f-pod"), String(offers)).toBeNull();
    }
  });

  it("the self-host door is honest that it opens soon", () => {
    const d = html(renderThreshold(keep, ctx({ offers: "open", door: "self" })));
    expect(d.querySelector("#reply")!.textContent).toContain(keep.ui.uiSelfSoon);
  });
});

describe("tile B in the page", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { disconnect() {} observe() {} });
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {} }));
  });

  const open = (readOffers: () => Promise<Offers>) => {
    const root = document.createElement("div");
    document.body.append(root);
    const options: PageOptions = {
      mode: "onboarding", done: new Set(["describe"]), draft: { name: "Atelier", city: "Anderlecht" },
      fold: { folded: false }, onSignIn: () => {}, onSignOut: () => {}, readOffers,
    };
    renderPage(root, tree, options);
    return root;
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const press = (root: HTMLElement, selector: string) => root.querySelector<HTMLElement>(selector)!.click();

  it("opens on tile B once tile A is done, asks the server once, then enables the pod door", async () => {
    const readOffers = vi.fn(async (): Promise<Offers> => "open");
    const root = open(readOffers);
    expect(root.querySelector(".wb-step-title")!.textContent).toBe(keep.title);
    expect(root.querySelector<HTMLButtonElement>('[data-door="pod"]')!.disabled).toBe(true);
    await settle();
    expect(root.querySelector<HTMLButtonElement>('[data-door="pod"]')!.disabled).toBe(false);
    expect(readOffers).toHaveBeenCalledTimes(1);
    press(root, '[data-door="self"]');
    press(root, "#not-now");
    expect(readOffers).toHaveBeenCalledTimes(1);
  });

  it("a pressed door is marked, and 'not now' / 'again' round-trip without sending anything", async () => {
    const root = open(async () => "open");
    await settle();
    press(root, '[data-door="self"]');
    expect(root.querySelector('[data-door="self"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelector('[data-door="pod"]')!.getAttribute("aria-pressed")).toBe("false");
    press(root, "#not-now");
    expect(root.querySelector("#reply")!.textContent).toContain("Nothing was sent.");
    press(root, "#doors-again");
    expect(root.querySelector("#reply")).toBeNull();
    expect(root.querySelector('[data-door="self"]')!.getAttribute("aria-pressed")).toBe("false");
  });

  it("'try again' asks the server a second time", async () => {
    const answers: Offers[] = ["down", "open"];
    const readOffers = vi.fn(async () => answers.shift()!);
    const root = open(readOffers);
    await settle();
    expect(root.querySelector('[data-door="pod"]')).toBeNull();
    press(root, "#offers-retry");
    await settle();
    expect(readOffers).toHaveBeenCalledTimes(2);
    expect(root.querySelector('[data-door="pod"]')).not.toBeNull();
  });
});
