/**
 * Tiles after A speak to the kind the coordinator picked (2026-11-19): a network's lines come from the
 * `*ForNetwork` variants in the tree, everything else (and the whole space) reads as it always did.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forKind } from "../tree/kind";
import { parseTree } from "../tree/parse";
import { renderPage } from "./page";
import { renderStep } from "./step";
import type { Draft } from "./previews";

const tree = parseTree(readFileSync(join(__dirname, "../../public/onboarding.ttl"), "utf8"));
const net = forKind(tree, "network");
const tileOf = (t: typeof tree, id: string) => t.tiles.find((x) => x.id === id)!;
const space = /\bspace\b|\bspace's\b|workshop|opening hours/i;
const network: Draft = { kind: "network", name: "Maakbib", areaServed: [{ code: "BE-VLG", name: "Flanders" }] };

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { disconnect() {} observe() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {} }));
});

const open = (draft: Draft, tile: string, done = ["describe", "keep"], extra = {}) => {
  const root = document.createElement("div");
  document.body.append(root);
  renderPage(root, tree, {
    mode: "workbench", who: "x", done: new Set(done), draft, fold: { folded: false },
    onSignIn: () => {}, onSignOut: () => {}, readOffers: async () => "open", saveHours: vi.fn(), ...extra,
  } as never);
  root.querySelector<HTMLElement>(`button[data-tile="${tile}"]`)!.click();
  return root;
};
const said = (root: HTMLElement) => root.querySelector("#step")!.textContent!.replace(/\s+/g, " ");

describe("forKind", () => {
  it("is one tree for a space, or when no kind is picked yet, and the same one each time", () => {
    expect(forKind(tree, "space")).toBe(forKind(tree, undefined));
    expect(forKind(tree, "space")).toBe(forKind(tree, "space"));
    expect(forKind(tree, "network")).toBe(net);
  });

  it("leaves a network's own tile out of a space's tree (onb:forKind, 2026-11-20)", () => {
    expect(forKind(tree, "space").tiles.map((t) => t.id)).not.toContain("welcome");
    expect(forKind(tree, undefined).tiles.map((t) => t.id)).not.toContain("welcome");
    expect(net.tiles.map((t) => t.id)).toContain("welcome");
    // Everything else is the same tiles, in the same order.
    expect(forKind(tree, "space").tiles.map((t) => t.id)).toEqual(tree.tiles.filter((t) => t.id !== "welcome").map((t) => t.id));
  });

  it("never draws the network's tile for a space", () => {
    const s = open({ name: "Weld Done", city: "Marolles" }, "change");
    expect(s.querySelector('button[data-tile="welcome"]')).toBeNull();
    s.remove();
    const n = open(network, "change");
    expect(n.querySelector('button[data-tile="welcome"]')).not.toBeNull();
    n.remove();
  });

  it("lays a network's variants over the space's lines and leaves the rest alone", () => {
    expect(tileOf(tree, "keep").ui.uiDoorPodDesc).toBe("Kept at Maps of Making under your space's name. You get tools that help you run your space.");
    expect(tileOf(net, "keep").ui.uiDoorPodDesc).toBe("Kept at Maps of Making under your network's name. You get tools that help you run your network.");
    expect(tileOf(net, "change").lines.say).toBe("Contact hours change. Change them here. Once.");
    expect(tileOf(tree, "change").lines.say).toBe("Hours change. Change them here. Once.");
    expect(tileOf(net, "handover").title).toBe("Hand over the network");
    expect(tileOf(tree, "handover").title).toBe("Hand over the space");
    // No variant: the space's line already fits both.
    expect(tileOf(net, "keep").ui.uiNotNow).toBe(tileOf(tree, "keep").ui.uiNotNow);
    expect(tileOf(net, "keep").title).toBe(tileOf(tree, "keep").title);
    // The variants themselves stay on the tile, and the profile's words follow too.
    expect(net.profile.fields.find((f) => f.key === "hours")!.label).toBe("Contact hours");
    expect(tree.profile.fields.find((f) => f.key === "hours")!.label).toBe("Opening hours");
    expect(net.profile.sections.find((s) => s.id === "times")!.label).toBe("Contact hours");
  });

  it("says no 'space' or 'workshop' on tiles B and C wherever a variant exists", () => {
    const hit: string[] = [];
    for (const id of ["keep", "change"]) {
      const t = tileOf(tree, id);
      const n = tileOf(net, id);
      for (const [k, v] of Object.entries(n.ui)) if (t.network?.ui[k] && space.test(v)) hit.push(`${id}.${k}`);
      for (const [k, v] of Object.entries(n.lines)) if (t.network?.lines[k] && space.test(v)) hit.push(`${id}.${k}`);
    }
    expect(hit).toEqual([]);
  });
});

describe("tiles speak to the kind picked", () => {

  it("tile C, first visit: a network sets contact hours; a space sets opening hours", () => {
    const n = open(network, "change");
    expect(n.querySelector(".bernard-voice")!.textContent).toBe("— Contact hours change. Change them here. Once.");
    expect(n.querySelector("label[for=f-hours-value], #f-hours-value")).not.toBeNull();
    expect(said(n)).toContain("Contact hours");
    expect(said(n)).not.toMatch(/opening hours/i);
    n.remove();
    const s = open({ name: "Weld Done", city: "Marolles" }, "change");
    expect(s.querySelector(".bernard-voice")!.textContent).toBe("— Hours change. Change them here. Once.");
    expect(said(s)).toContain("Opening hours");
    s.remove();
  });

  it("tile B, signed out: the pod door says network; a space's says space", () => {
    const n = open(network, "keep", ["describe"], { saveHours: undefined });
    expect(n.querySelector("[data-door=pod] .wb-door-desc")!.textContent).toContain("your network's name");
    expect(said(n)).not.toMatch(/your space/i);
    n.remove();
    const s = open({ name: "Weld Done", city: "Marolles" }, "keep", ["describe"], { saveHours: undefined });
    expect(s.querySelector("[data-door=pod] .wb-door-desc")!.textContent).toContain("your space's name");
    s.remove();
  });

  it("a card for a network names its hours row 'Contact hours' (tile A's done view)", () => {
    const html = renderStep(tileOf(net, "describe"), { tiles: net.tiles, states: new Map([["describe", "done"]]), draft: { ...network, hours: "Mo 9-12" } });
    expect(html).toContain("Contact hours");
    const plain = renderStep(tileOf(tree, "describe"), { tiles: tree.tiles, states: new Map([["describe", "done"]]), draft: { name: "W", city: "M", hours: "Mo 9-12" } });
    expect(plain).toContain(">Hours<");
    expect(plain).not.toContain("Contact hours");
  });
});
