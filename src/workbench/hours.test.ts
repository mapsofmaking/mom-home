import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HoursResult } from "../lib/hours";
import { PublishError } from "../lib/publish";
import { draftFromTurtle, spaceFile } from "../lib/spacefile";
import { DONE_CHECKS } from "../tiles/done";
import { parseTree } from "../tree/parse";
import { renderPage } from "./page";
import type { Draft } from "./previews";

const tree = parseTree(readFileSync(join(__dirname, "../../public/onboarding.ttl"), "utf8"));
const change = tree.tiles.find((t) => t.id === "change")!;
const settle = () => new Promise((r) => setTimeout(r, 0));
const text = (root: HTMLElement, sel: string) => root.querySelector(sel)!.textContent!.replace(/\s+/g, " ").trim();

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { disconnect() {} observe() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {} }));
});

function open(saveHours: (h: string) => Promise<HoursResult>, draft: Draft = { name: "Weld Done", city: "Marolles", country: "BE", lat: "50.8", lon: "4.3" }) {
  const root = document.createElement("div");
  document.body.append(root);
  renderPage(root, tree, {
    mode: "workbench", who: "weld-done", done: new Set(["describe", "keep"]), draft, fold: { folded: false },
    onSignIn: () => {}, onSignOut: () => {}, readOffers: async () => "open", saveHours,
  });
  root.querySelector<HTMLElement>('button[data-tile="change"]')!.click();
  return root;
}
const type = (root: HTMLElement, value: string) => {
  root.querySelector<HTMLInputElement>("#f-hours-value")!.value = value;
  root.querySelector<HTMLElement>("#hours-save")!.click();
};

describe("tile C, the first time (14.6 S1, #36)", () => {
  it("is one field and Save, with Bernard's line; no Coming chip", () => {
    const root = open(vi.fn());
    expect(root.querySelector("#f-hours-value")).not.toBeNull();
    expect(root.querySelector(".bernard-voice")!.textContent).toBe(`— ${change.lines.say}`);
    expect(root.querySelector("#step .status-label")).toBeNull();
    root.remove();
  });

  it("opens with the hours the file already says", () => {
    const root = open(vi.fn(), { name: "Weld Done", hours: "Mo 9-12" });
    expect(root.querySelector<HTMLInputElement>("#f-hours-value")!.value).toBe("Mo 9-12");
    root.remove();
  });

  it("saves once, shows what it was and the file's line, and tile C is done", async () => {
    const saveHours = vi.fn(async (h: string): Promise<HoursResult> => ({ status: "saved", was: "Mo 9-12", hours: h }));
    const root = open(saveHours);
    type(root, "Tu-Fr 12:00-20:00");
    root.querySelector<HTMLElement>("#hours-save")?.click();
    await settle();
    expect(saveHours).toHaveBeenCalledTimes(1);
    expect(text(root, "#hours-was")).toBe(change.ui.uiHoursWas.replace("{was}", "Mo 9-12"));
    expect(text(root, ".wb-file-line")).toBe('schema:openingHours "Tu-Fr 12:00-20:00" ;');
    expect(root.querySelector('[data-tile="change"]')!.className).toContain("done");
    root.remove();
  });

  it("the same hours: said plainly, not as an error, nothing marked done", async () => {
    const root = open(vi.fn(async (h: string): Promise<HoursResult> => ({ status: "same", was: h, hours: h })));
    type(root, "Mo 9-12");
    await settle();
    expect(text(root, "#hours-status")).toBe(change.ui.uiHoursSame);
    expect(root.querySelector("#hours-status")!.className).not.toContain("is-error");
    expect(root.querySelector('[data-tile="change"]')!.className).not.toContain("done");
    root.remove();
  });

  it("empty: asks for the hours, never calls the pod", async () => {
    const saveHours = vi.fn();
    const root = open(saveHours);
    type(root, "  ");
    await settle();
    expect(saveHours).not.toHaveBeenCalled();
    expect(text(root, "#hours-status")).toBe(change.ui.uiHoursEmpty);
    root.remove();
  });

  it("each failure has its own line, and what was typed stays", async () => {
    const cases: [PublishError, string][] = [
      [new PublishError("conflict", "x", 412), change.ui.uiHoursConflict],
      [new PublishError("expired", "x", 401), change.ui.uiHoursExpired],
      [new PublishError("gone", "x", 404), change.ui.uiHoursGone],
      [new PublishError("unreachable", "x"), change.ui.uiHoursUnreachable],
      [new PublishError("unreadable", "x"), change.ui.uiHoursUnreadable],
      [new PublishError("refused", "x", 500), change.ui.uiHoursRefused],
    ];
    for (const [error, line] of cases) {
      const root = open(vi.fn(async () => { throw error; }));
      type(root, "Mo 9-17");
      await settle();
      expect(text(root, "#hours-status"), error.code).toBe(line);
      expect(root.querySelector<HTMLInputElement>("#f-hours-value")!.value).toBe("Mo 9-17");
      expect(root.querySelector<HTMLButtonElement>("#hours-save")!.disabled).toBe(false);
      root.remove();
    }
  });

  it("one save at a time, and a tile click waits for it", async () => {
    let finish!: (r: HoursResult) => void;
    const saveHours = vi.fn(() => new Promise<HoursResult>((r) => { finish = r; }));
    const root = open(saveHours);
    type(root, "Mo 9-17");
    root.querySelector<HTMLElement>("#hours-save")!.click();
    root.querySelector<HTMLElement>('button[data-tile="describe"]')!.click();
    expect(saveHours).toHaveBeenCalledTimes(1);
    expect(root.querySelector("#f-hours")).not.toBeNull();
    finish({ status: "saved", was: null, hours: "Mo 9-17" });
    await settle();
    expect(text(root, "#hours-was")).toBe(change.ui.uiHoursNew);
    root.remove();
  });

  it("Change them again opens the field with the saved hours", async () => {
    const root = open(vi.fn(async (h: string): Promise<HoursResult> => ({ status: "saved", was: null, hours: h })));
    type(root, "Mo 9-17");
    await settle();
    root.querySelector<HTMLElement>("#hours-again")!.click();
    expect(root.querySelector<HTMLInputElement>("#f-hours-value")!.value).toBe("Mo 9-17");
    root.remove();
  });
});

describe("hours in the space file, and tile C's done (14.6 S1, AC5)", () => {
  const base: Draft = { name: "Weld Done", city: "Marolles", country: "BE", lat: "50.8", lon: "4.3" };

  it("are written as schema:openingHours and read back", () => {
    const { turtle } = spaceFile({ ...base, hours: "Mo 9-12" });
    expect(turtle).toContain('schema:openingHours "Mo 9-12"');
    expect(draftFromTurtle(turtle, "https://weld-done.pod.example/space.ttl")!.hours).toBe("Mo 9-12");
  });

  it("a file without hours writes none", () => {
    expect(spaceFile(base).turtle).not.toContain("openingHours");
  });

  it("done when the space's file says its hours, never otherwise", async () => {
    const ctx = { webId: "w", podRoot: "p", space: "https://weld-done.pod.example/space.ttl#space" };
    expect(await DONE_CHECKS.change({ ...ctx, spaceData: { ...base, hours: "Mo 9-12" } })).toBe(true);
    expect(await DONE_CHECKS.change({ ...ctx, spaceData: base })).toBe(false);
    expect(await DONE_CHECKS.change({ ...ctx, space: null, spaceData: { ...base, hours: "Mo 9-12" } })).toBe(false);
  });
});
