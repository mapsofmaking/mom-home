import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublishError, type FileResult } from "../lib/publish";
import { parseTree } from "../tree/parse";
import { renderPage } from "./page";
import type { Draft } from "./previews";
import { IDLE, renderPublishPanel } from "./publish";

const tree = parseTree(readFileSync(join(__dirname, "../../public/onboarding.ttl"), "utf8"));
const keep = tree.tiles.find((t) => t.id === "keep")!;
const URL_ = "https://weld-done.pod.example/space.ttl";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { disconnect() {} observe() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {} }));
});

const settle = () => new Promise((r) => setTimeout(r, 0));
const draft: Draft = { name: "Weld Done", city: "Marolles", country: "BE", lat: "50.8371", lon: "4.3458" };

function open(publishSpace: (d: Draft) => Promise<FileResult>, extra: Record<string, unknown> = {}) {
  const root = document.createElement("div");
  document.body.append(root);
  renderPage(root, tree, {
    mode: "workbench", who: "Weld Done", done: new Set(["describe"]), draft, fold: { folded: false },
    onSignIn: () => {}, onSignOut: () => {}, readOffers: async () => "open", publishSpace, ...extra,
  });
  return root;
}
const ok = (status: FileResult["status"] = "written", dropped: FileResult["dropped"] = []): FileResult => ({ url: URL_, status, dropped });
const text = (root: HTMLElement, sel: string) => root.querySelector(sel)!.textContent!.replace(/\s+/g, " ").trim();

describe("the publish panel (14.4 AC1)", () => {
  it("shows the one step and the one button, and nothing is claimed before anything happened", () => {
    const html = document.createElement("div");
    html.innerHTML = renderPublishPanel(keep, IDLE);
    expect(html.querySelector("li strong")!.textContent).toBe(keep.ui.uiStepFile);
    expect(html.querySelector("#publish-go")!.textContent).toBe(keep.ui.uiPublishGo);
    expect(html.querySelector("#publish-status")!.textContent).toBe("");
  });

  it("a step in flight disables the button and says it is working", () => {
    const html = document.createElement("div");
    html.innerHTML = renderPublishPanel(keep, { ...IDLE, file: "working" });
    expect(html.querySelector<HTMLButtonElement>("#publish-go")!.disabled).toBe(true);
    expect(html.textContent).toContain(keep.ui.uiStepFileWorking);
  });
});

describe("tile B, signed in with a pod (14.4)", () => {
  it("offers the button instead of the two doors, with Bernard's line", () => {
    const root = open(vi.fn(async () => ok()));
    expect(root.querySelector(".wb-doors")).toBeNull();
    expect(root.querySelector("#publish-go")).not.toBeNull();
    expect(root.querySelector(".bernard-voice")!.textContent).toBe(`— ${keep.lines.sayPublish}`);
  });

  it("right after the sign-in, the pod-ready panel carries the button", () => {
    const root = open(vi.fn(async () => ok()), { podReady: { webId: "https://weld-done.pod.example/profile/card#me", pod: "https://weld-done.pod.example/" } });
    expect(root.querySelector(".bernard-voice")!.textContent).toBe(`— ${keep.lines.saidPodReady}`);
    expect(root.querySelector("#publish-go")).not.toBeNull();
  });

  it("without a pod to write to (nothing passed), it is the signed-out tile", () => {
    const root = document.createElement("div");
    renderPage(root, tree, { mode: "onboarding", done: new Set(["describe"]), draft, fold: { folded: false }, onSignIn: () => {}, onSignOut: () => {}, readOffers: async () => "open" });
    expect(root.querySelector("#publish-go")).toBeNull();
  });

  it("writes the draft once, says where the file is, and keeps the draft", async () => {
    const publishSpace = vi.fn(async () => ok());
    const root = open(publishSpace);
    root.querySelector<HTMLElement>("#publish-go")!.click();
    root.querySelector<HTMLElement>("#publish-go")?.click();
    await settle();
    expect(publishSpace).toHaveBeenCalledTimes(1);
    expect(publishSpace).toHaveBeenCalledWith(draft);
    expect(text(root, "#publish")).toContain(keep.ui.uiStepFileWritten.replace("{address}", URL_));
    expect(text(root, "#publish-status")).toContain(keep.ui.uiPublishNext);
    expect(draft.name).toBe("Weld Done");
  });

  it("redraws the panel in place: the box and the screen around it are the same elements", async () => {
    const root = open(vi.fn(async () => ok()));
    const box = root.querySelector("#publish")!;
    const title = root.querySelector(".wb-step-title")!;
    root.querySelector<HTMLElement>("#publish-go")!.click();
    expect(root.querySelector("#publish")).toBe(box);
    await settle();
    expect(root.querySelector("#publish")).toBe(box);
    expect(root.querySelector(".wb-step-title")).toBe(title);
  });

  it("says what happened to a file that was already there, and what was left out of it", async () => {
    for (const [status, line] of [["already-there", keep.ui.uiStepFileThere], ["kept-existing", keep.ui.uiStepFileKept]] as const) {
      const root = open(vi.fn(async () => ok(status, ["website"])));
      root.querySelector<HTMLElement>("#publish-go")!.click();
      await settle();
      expect(text(root, "#publish")).toContain(line);
      expect(text(root, "#publish-status")).toContain("website");
      root.remove();
    }
  });

  it("each failure has its own line, and the button stays for the retry", async () => {
    const cases: [PublishError, string][] = [
      [new PublishError("incomplete", "x", null, ["town", "pin"]), keep.ui.uiPublishIncomplete.replace("{missing}", `${keep.ui.uiMissingTown}, ${keep.ui.uiMissingPin}`)],
      [new PublishError("expired", "x", 401), keep.ui.uiPublishExpired],
      [new PublishError("unreachable", "x"), keep.ui.uiPublishUnreachable],
      [new PublishError("unreadable", "x"), keep.ui.uiPublishUnreadable],
      [new PublishError("refused", "x", 500), keep.ui.uiPublishRefused.replace("{status}", "500")],
    ];
    for (const [error, line] of cases) {
      const root = open(vi.fn(async () => { throw error; }));
      root.querySelector<HTMLElement>("#publish-go")!.click();
      await settle();
      expect(text(root, "#publish-status"), error.code).toBe(line);
      expect(root.querySelector<HTMLButtonElement>("#publish-go")!.disabled).toBe(false);
      expect(document.activeElement).toBe(root.querySelector("#publish-go"));
      root.remove();
    }
  });

  it("a retry after a failure runs the step again, from the file", async () => {
    let n = 0;
    const publishSpace = vi.fn(async () => { if (n++ === 0) throw new PublishError("unreachable", "x"); return ok(); });
    const root = open(publishSpace);
    root.querySelector<HTMLElement>("#publish-go")!.click();
    await settle();
    root.querySelector<HTMLElement>("#publish-go")!.click();
    await settle();
    expect(publishSpace).toHaveBeenCalledTimes(2);
    expect(text(root, "#publish")).toContain(keep.ui.uiStepFileWritten.replace("{address}", URL_));
  });

  it("a tile click while the file is being written waits: the answer must land on its panel", async () => {
    let finish!: (r: FileResult) => void;
    const root = open(vi.fn(() => new Promise<FileResult>((r) => { finish = r; })));
    const box = root.querySelector("#publish")!;
    root.querySelector<HTMLElement>("#publish-go")!.click();
    root.querySelector<HTMLElement>('button[data-tile="describe"]')!.click();
    expect(root.querySelector("#publish")).toBe(box);
    finish(ok());
    await settle();
    expect(text(root, "#publish")).toContain(keep.ui.uiStepFileWritten.replace("{address}", URL_));
  });
});
