/**
 * The welcome tile's panel (#69): what the pod says decides what shows. Only "not set up" offers the form, and
 * a pod that can't be read offers nothing that writes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forKind } from "../tree/kind";
import { parseTree } from "../tree/parse";
import { PublishError } from "../lib/publish";
import type { Collective, CollectiveState } from "../lib/collective";
import { mountWelcome, type WelcomeDeps, type WelcomeHandle } from "./welcome";
import { renderStep } from "./step";
import { renderPage } from "./page";

const tree = forKind(parseTree(readFileSync(join(__dirname, "../../public/onboarding.ttl"), "utf8")), "network");
const tile = tree.tiles.find((t) => t.act === "welcome")!;
const ui = tile.ui;

const CONFIG = "https://zz-net.pod.example/config.ttl";
const collective: Collective = { configUrl: CONFIG, group: CONFIG + "#zz-net", name: "ZZ Net", roster: "https://zz-net.pod.example/membres.ttl", inbox: "https://zz-net.pod.example/inbox/", sharing: false };
const LINK = "https://backoffice.mapsofmaking.org/?collective=" + CONFIG;
const DONE: CollectiveState = { state: "done", configUrl: CONFIG, collective, link: LINK };

let box: HTMLElement;
let handle: WelcomeHandle | null = null;
beforeEach(() => {
  document.body.innerHTML = `<div id="box"></div>`;
  box = document.getElementById("box")!;
});
afterEach(() => handle?.destroy());

const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};
const open = async (extra: Partial<WelcomeDeps>) => {
  const deps: WelcomeDeps = { tile, name: "ZZ Net", description: "A network of test workshops.", load: async () => ({ state: "none", configUrl: CONFIG }), setUp: vi.fn(async () => DONE), ...extra };
  handle = mountWelcome(box, deps);
  await settle();
  return deps;
};
const text = () => box.textContent!.replace(/\s+/g, " ");

describe("the welcome tile (#69)", () => {
  it("not set up: the form, its description prefilled from the network's file, and one button", async () => {
    const onDone = vi.fn();
    const deps = await open({ onDone });
    expect(box.querySelector<HTMLTextAreaElement>("#f-welcome-description")!.value).toBe("A network of test workshops.");
    expect(box.querySelector<HTMLInputElement>("#f-welcome-slogan")!.placeholder).toBe("Join the ZZ Net network");
    expect(box.querySelectorAll("button")).toHaveLength(1);
    expect(box.querySelectorAll(".bernard-voice")).toHaveLength(1);

    const slogan = box.querySelector<HTMLInputElement>("#f-welcome-slogan")!;
    slogan.value = "Join ZZ";
    slogan.dispatchEvent(new Event("input", { bubbles: true }));
    box.querySelector<HTMLFormElement>("#f-welcome")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(deps.setUp).toHaveBeenCalledWith({ slogan: "Join ZZ", description: "A network of test workshops." });
    // Done: the link, the copy button, and where requests arrive.
    expect(box.querySelector<HTMLAnchorElement>("#welcome-link")!.href).toBe(LINK);
    expect(box.querySelector<HTMLElement>("#welcome-copy")!.dataset.copy).toBe(LINK);
    expect(box.querySelector<HTMLAnchorElement>("#welcome-backoffice")!.href).toBe("https://backoffice.mapsofmaking.org/");
    expect(text()).toContain(ui.uiWelcomeRequests);
    expect(box.querySelector("#f-welcome")).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("done on the pod: the link at once, and nothing set up", async () => {
    const deps = await open({ load: async () => DONE });
    expect(box.querySelector("#welcome-link")).not.toBeNull();
    expect(box.querySelector("#f-welcome")).toBeNull();
    expect(deps.setUp).not.toHaveBeenCalled();
  });

  it("a session refused, or a config.ttl that can't be read: said, and no button that writes", async () => {
    for (const err of [new PublishError("expired", "401", 401), new PublishError("unreadable", "config.ttl is not valid Turtle: Undefined prefix")]) {
      const deps = await open({ load: async () => { throw err; } });
      expect(box.querySelector("#f-welcome")).toBeNull();
      expect(box.querySelector("#welcome-go")).toBeNull();
      expect(box.querySelector("#welcome-retry")).toBeNull();
      expect(deps.setUp).not.toHaveBeenCalled();
      handle!.destroy();
    }
    await open({ load: async () => { throw new PublishError("unreadable", "config.ttl is not valid Turtle: Undefined prefix"); } });
    expect(text()).toContain("Undefined prefix");
  });

  it("a config.ttl this app didn't write, with something missing: said in plain words, nothing to press", async () => {
    const deps = await open({ load: async () => ({ state: "foreign", configUrl: CONFIG, collective, missing: ["public", "roster"] }) });
    expect(box.querySelector("button")).toBeNull();
    expect(box.querySelector("#f-welcome")).toBeNull();
    expect(text()).toContain(ui.uiWelcomeMissingPublic);
    expect(text()).toContain(ui.uiWelcomeMissingRoster);
    expect(text()).not.toContain(ui.uiWelcomeUnfinished);
    expect(deps.setUp).not.toHaveBeenCalled();
  });

  it("a 403 (this account may not read it) is said in the tile, with nothing to press", async () => {
    await open({ load: async () => { throw new PublishError("no-control", "403", 403); } });
    expect(box.querySelector("#welcome-status")!.textContent).toBe(ui.uiWelcomeNoRead);
    expect(box.querySelector("button")).toBeNull();
  });

  it("a pod that didn't answer: read again, never the form", async () => {
    let calls = 0;
    await open({ load: async () => { if (calls++ === 0) throw new PublishError("unreachable", "no answer"); return DONE; } });
    expect(box.querySelector("#f-welcome")).toBeNull();
    box.querySelector<HTMLElement>("#welcome-retry")!.click();
    await settle();
    expect(box.querySelector("#welcome-link")).not.toBeNull();
  });

  it("a setup that stopped halfway: one button that carries on", async () => {
    const deps = await open({ load: async () => ({ state: "incomplete", configUrl: CONFIG, collective, missing: ["roster"] }) });
    expect(box.querySelector("#f-welcome")).toBeNull();
    expect(text()).toContain(ui.uiWelcomeUnfinished);
    box.querySelector<HTMLElement>("#welcome-go")!.click();
    await settle();
    expect(deps.setUp).toHaveBeenCalledTimes(1);
    expect(box.querySelector("#welcome-link")).not.toBeNull();
  });

  it("a setup that failed keeps what was typed and says why", async () => {
    await open({ setUp: async () => { throw new PublishError("conflict", "412"); } });
    const slogan = box.querySelector<HTMLInputElement>("#f-welcome-slogan")!;
    slogan.value = "Join ZZ";
    box.querySelector<HTMLFormElement>("#f-welcome")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(box.querySelector<HTMLInputElement>("#f-welcome-slogan")!.value).toBe("Join ZZ");
    expect(box.querySelector("#welcome-status")!.textContent).toBe(ui.uiWelcomeConflict);
  });

  it("signed out: it says it needs the network's pod, and offers nothing", () => {
    const html = renderStep(tile, { tiles: tree.tiles, states: new Map([["welcome", "open"]]), draft: { kind: "network" } });
    const div = document.createElement("div");
    div.innerHTML = html;
    expect(div.textContent).toContain(ui.uiWelcomeNeedsPod);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Coming");
  });
});

describe("on the page", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { disconnect() {} observe() {} });
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {} }));
  });

  it("a published network opens it first, mounts it once, and the hexes say done when the pod does", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const load = vi.fn(async (): Promise<CollectiveState> => ({ state: "none", configUrl: CONFIG }));
    const setUp = vi.fn(async () => DONE);
    const base = parseTree(readFileSync(join(__dirname, "../../public/onboarding.ttl"), "utf8"));
    const page = renderPage(root, base, {
      mode: "workbench", who: "x", done: new Set(["describe", "keep"]), draft: { kind: "network", name: "ZZ Net", description: "Tests." },
      fold: { folded: false }, onSignIn: () => {}, onSignOut: () => {}, readOffers: async () => "open", welcome: { load, setUp },
    } as never);
    const hex = root.querySelector<HTMLElement>('#hexes button[data-tile="welcome"]')!;
    expect(hex.className).toContain("open");
    hex.click();
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    root.querySelector<HTMLFormElement>("#f-welcome")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(root.querySelector('#hexes button[data-tile="welcome"]')!.className).toContain("done");
    expect(root.querySelector("#welcome-link")).not.toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    page.destroy();
    root.remove();
  });
});
