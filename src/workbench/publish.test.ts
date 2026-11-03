import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnMap } from "../lib/onmap";
import { PublishError, type FileResult, type PublicResult } from "../lib/publish";
import { parseTree } from "../tree/parse";
import { draftKey, renderPage } from "./page";
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
    onSignIn: () => {}, onSignOut: () => {}, readOffers: async () => "open", publishSpace,
    makePublic: async (): Promise<PublicResult> => ({ status: "made-public" }),
    // The map step, by default never answering: tests of the first two steps see the panel as it is mid-run.
    putOnMap: () => new Promise<OnMap>(() => {}), ...extra,
  });
  return root;
}
const ok = (status: FileResult["status"] = "written", dropped: FileResult["dropped"] = []): FileResult => ({ url: URL_, status, dropped });
const text = (root: HTMLElement, sel: string) => root.querySelector(sel)!.textContent!.replace(/\s+/g, " ").trim();

describe("the publish panel (14.4 AC1)", () => {
  it("before the press, only the button: no step list that reads as a checkbox, nothing claimed", () => {
    const html = document.createElement("div");
    html.innerHTML = renderPublishPanel(keep, IDLE);
    expect(html.querySelector("li")).toBeNull();
    expect(html.querySelector("#publish-go")!.textContent).toBe(keep.ui.uiPublishGo);
    expect(html.querySelector("#publish-status")!.textContent).toBe("");
  });

  it("a step in flight disables the button and says it is working", () => {
    const html = document.createElement("div");
    html.innerHTML = renderPublishPanel(keep, { ...IDLE, file: "working" });
    expect(html.querySelector<HTMLButtonElement>("#publish-go")!.disabled).toBe(true);
    expect(html.textContent).toContain(keep.ui.uiStepFileWorking);
    expect(html.querySelector("li strong")!.textContent).toBe(keep.ui.uiStepFile);
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

describe("the public step (14.4 S2, #12)", () => {
  const pub = (status: PublicResult["status"] = "made-public") => vi.fn(async (): Promise<PublicResult> => ({ status }));

  it("after the file, opens it to anyone, says so, and goes on to the map", async () => {
    const makePublic = pub();
    const root = open(vi.fn(async () => ok()), { makePublic });
    root.querySelector<HTMLElement>("#publish-go")!.click();
    await settle();
    await settle();
    expect(makePublic).toHaveBeenCalledTimes(1);
    expect(root.querySelectorAll("li")).toHaveLength(3);
    expect(text(root, "#publish")).toContain(keep.ui.uiStepPublicDone);
    expect(text(root, "#publish")).toContain(keep.ui.uiStepMapWorking);
    expect(root.querySelector<HTMLButtonElement>("#publish-go")!.disabled).toBe(true);
  });

  it("says when anyone could already read it", async () => {
    const root = open(vi.fn(async () => ok("already-there")), { makePublic: pub("already-public") });
    root.querySelector<HTMLElement>("#publish-go")!.click();
    await settle();
    await settle();
    expect(text(root, "#publish")).toContain(keep.ui.uiStepPublicAlready);
  });

  it("never runs when the file step failed", async () => {
    const makePublic = pub();
    const root = open(vi.fn(async () => { throw new PublishError("unreachable", "x"); }), { makePublic });
    root.querySelector<HTMLElement>("#publish-go")!.click();
    await settle();
    expect(makePublic).not.toHaveBeenCalled();
  });

  it("each of its failures has its own line, the file step stays done, and the button stays for the retry", async () => {
    const cases: [PublishError, string][] = [
      [new PublishError("rules-unknown", "x"), keep.ui.uiPublicUnknown],
      [new PublishError("not-public", "x", 401), keep.ui.uiPublicNotPublic.replace("{status}", "401")],
      [new PublishError("expired", "x", 401), keep.ui.uiPublishExpired],
      [new PublishError("rules-wider", "x"), keep.ui.uiPublicWider],
      [new PublishError("no-control", "x", 403), keep.ui.uiPublicNoControl],
      [new PublishError("conflict", "x", 412), keep.ui.uiPublicConflict],
      [new PublishError("gone", "x", 404), keep.ui.uiPublicGone],
      [new PublishError("no-wac", "x"), keep.ui.uiPublicNoWac],
      [new PublishError("not-public", "x", 403, [], "already-public"), keep.ui.uiPublicBlocked.replace("{status}", "403")],
    ];
    for (const [error, line] of cases) {
      const root = open(vi.fn(async () => ok()), { makePublic: vi.fn(async () => { throw error; }) });
      root.querySelector<HTMLElement>("#publish-go")!.click();
      await settle();
      await settle();
      expect(text(root, "#publish-status"), error.code).toBe(line);
      expect(text(root, "#publish")).toContain(keep.ui.uiStepFileWritten.replace("{address}", URL_));
      expect(root.querySelector<HTMLButtonElement>("#publish-go")!.disabled).toBe(false);
      root.remove();
    }
  });
});

describe("a retry resumes from the step that failed (14.4 AC5, review of #23)", () => {
  it("after the public step failed, pressing again runs only the public step", async () => {
    let n = 0;
    const publishSpace = vi.fn(async () => ok());
    const makePublic = vi.fn(async (): Promise<PublicResult> => { if (n++ === 0) throw new PublishError("conflict", "x", 412); return { status: "made-public" }; });
    const root = open(publishSpace, { makePublic });
    root.querySelector<HTMLElement>("#publish-go")!.click();
    await settle(); await settle();
    root.querySelector<HTMLElement>("#publish-go")!.click();
    await settle(); await settle();
    expect(publishSpace).toHaveBeenCalledTimes(1);
    expect(makePublic).toHaveBeenCalledTimes(2);
    expect(text(root, "#publish")).toContain(keep.ui.uiStepFileWritten.replace("{address}", URL_));
    expect(text(root, "#publish")).toContain(keep.ui.uiStepPublicDone);
  });

  it("when the file was gone, pressing again writes it anew first", async () => {
    let n = 0;
    const publishSpace = vi.fn(async () => ok());
    const makePublic = vi.fn(async (): Promise<PublicResult> => { if (n++ === 0) throw new PublishError("gone", "x", 404); return { status: "made-public" }; });
    const root = open(publishSpace, { makePublic });
    root.querySelector<HTMLElement>("#publish-go")!.click();
    await settle(); await settle();
    root.querySelector<HTMLElement>("#publish-go")!.click();
    await settle(); await settle();
    expect(publishSpace).toHaveBeenCalledTimes(2);
  });

  it("without the public step, the button does nothing: never a panel that says 'anyone can read it' untrue", async () => {
    const publishSpace = vi.fn(async () => ok());
    const root = open(publishSpace, { makePublic: undefined });
    root.querySelector<HTMLElement>("#publish-go")?.click();
    await settle();
    expect(publishSpace).not.toHaveBeenCalled();
  });
});

describe("signed in again, it continues where it stopped (14.4 S5, #15; AC1, AC5)", () => {
  const never = () => vi.fn(() => new Promise<OnMap>(() => {}));
  const press = async (root: HTMLElement) => {
    root.querySelector<HTMLElement>("#publish-go")!.click();
    for (let i = 0; i < 3; i++) await settle();
  };

  it("the file on the pod, not yet open: the file step shows done, and pressing runs the public step and the map", async () => {
    const publishSpace = vi.fn(async () => ok());
    const makePublic = vi.fn(async (): Promise<PublicResult> => ({ status: "made-public" }));
    const putOnMap = never();
    const root = open(publishSpace, { makePublic, putOnMap, onPod: { fileUrl: URL_, open: false } });
    expect(text(root, "#publish")).toContain(keep.ui.uiStepFileThere);
    await press(root);
    expect(publishSpace).not.toHaveBeenCalled();
    expect(makePublic).toHaveBeenCalledTimes(1);
    expect(putOnMap).toHaveBeenCalledWith(URL_);
    root.remove();
  });

  it("the file open to anyone already: pressing runs only the map step", async () => {
    const publishSpace = vi.fn(async () => ok());
    const makePublic = vi.fn(async (): Promise<PublicResult> => ({ status: "made-public" }));
    const putOnMap = never();
    const root = open(publishSpace, { makePublic, putOnMap, onPod: { fileUrl: URL_, open: true } });
    expect(text(root, "#publish")).toContain(keep.ui.uiStepPublicAlready);
    await press(root);
    expect(publishSpace).not.toHaveBeenCalled();
    expect(makePublic).not.toHaveBeenCalled();
    expect(putOnMap).toHaveBeenCalledTimes(1);
    root.remove();
  });

  it("an edit made since the file was written is written first: a resume never leaves it behind", async () => {
    const edited: Draft = { ...draft };
    const publishSpace = vi.fn(async () => ok("written"));
    const root = document.createElement("div");
    document.body.append(root);
    renderPage(root, tree, {
      mode: "workbench", who: "Weld Done", done: new Set(["describe"]), draft: edited, fold: { folded: false },
      onSignIn: () => {}, onSignOut: () => {}, readOffers: async () => "open", publishSpace,
      makePublic: async (): Promise<PublicResult> => ({ status: "already-public" }), putOnMap: never(),
      onPod: { fileUrl: URL_, open: true },
    });
    edited.website = "https://welddone.example/";
    await press(root);
    expect(publishSpace).toHaveBeenCalledTimes(1);
    expect(publishSpace).toHaveBeenCalledWith(edited);
    root.remove();
  });

  it("a session that ended at the public step: sign in again, press, and only the public step and the map run", async () => {
    const publishSpace = vi.fn(async () => ok());
    // Before: the file is written, the public step hears 401.
    const before = open(publishSpace, { makePublic: vi.fn(async () => { throw new PublishError("expired", "x", 401); }) });
    await press(before);
    expect(text(before, "#publish-status")).toBe(keep.ui.uiPublishExpired);
    before.remove();
    // After the sign-in: the shell reads the file back from the pod, not readable by anyone yet.
    const makePublic = vi.fn(async (): Promise<PublicResult> => ({ status: "made-public" }));
    const putOnMap = never();
    const after = open(publishSpace, { makePublic, putOnMap, onPod: { fileUrl: URL_, open: false } });
    await press(after);
    expect(publishSpace).toHaveBeenCalledTimes(1);
    expect(makePublic).toHaveBeenCalledTimes(1);
    expect(putOnMap).toHaveBeenCalledTimes(1);
    after.remove();
  });

  it("the same draft whatever order its fields were set in, empty fields left out", () => {
    expect(draftKey({ name: "A", city: "B" })).toBe(draftKey({ city: "B", name: "A", website: "" }));
    expect(draftKey({ name: "A" })).not.toBe(draftKey({ name: "A", city: "B" }));
  });
});

describe("on the map, and the threshold (14.4 S3, #13; AC4, AC4b)", () => {
  const onMap = (pin = true): OnMap => ({
    id: "weld-done",
    link: "https://mapsofmaking.org/?space=weld-done",
    pin: pin ? { id: "weld-done", name: "Weld Done", lat: 50.8371, lon: 4.3458, city: "Marolles", country: "Belgium" } : null,
  });
  const go = async (root: HTMLElement) => {
    root.querySelector<HTMLElement>("#publish-go")!.click();
    for (let i = 0; i < 4; i++) await settle();
  };

  it("registers the file's address, then shows the threshold: the pin read back, the address to copy, the way on to tile C", async () => {
    const putOnMap = vi.fn(async () => onMap());
    const root = open(vi.fn(async () => ok()), { putOnMap });
    await go(root);
    expect(putOnMap).toHaveBeenCalledWith(URL_);
    const body = text(root, "#step");
    expect(body).toContain(keep.lines.saidDone!.replace("{locality}", "Marolles"));
    expect(body).toContain(keep.ui.uiOnMapLive);
    expect(body).toContain("Weld Done · 50.83710, 4.34580 · Marolles");
    expect(root.querySelector<HTMLElement>("#copy-address")!.dataset.copy).toBe(URL_);
    expect(body).toContain(keep.lines.sayNext!);
    expect(root.querySelector<HTMLAnchorElement>('a[href="https://mapsofmaking.org/?space=weld-done"]')!.target).toBe("_blank");
    const next = root.querySelector<HTMLElement>('.wb-out [data-go="change"]')!;
    expect(document.activeElement).toBe(next);
    // Tile B is done in this tab, and its word unlocks.
    expect(root.querySelector('[data-tile="keep"]')!.className).toContain("done");
    expect(root.querySelector("#words")!.textContent).toMatch(/pod/i);
    // The one way on goes to tile C.
    next.click();
    expect(root.querySelector('[aria-current="step"]')!.getAttribute("data-tile")).toBe("change");
  });

  it("a pin the map hasn't drawn yet says so, never a pin drawn here", async () => {
    const root = open(vi.fn(async () => ok()), { putOnMap: vi.fn(async () => onMap(false)) });
    await go(root);
    expect(text(root, "#step")).toContain(keep.ui.uiPinLate);
    expect(text(root, "#step")).not.toContain(keep.ui.uiOnMapLive);
  });

  it("the map's own failures have their own lines, and a retry runs only the map step", async () => {
    let n = 0;
    const publishSpace = vi.fn(async () => ok());
    const makePublic = vi.fn(async (): Promise<PublicResult> => ({ status: "made-public" }));
    const putOnMap = vi.fn(async () => {
      if (n++ === 0) throw new PublishError("map-refused", "x", 422);
      return onMap();
    });
    const root = open(publishSpace, { makePublic, putOnMap });
    await go(root);
    expect(text(root, "#publish-status")).toBe(keep.ui.uiMapRefused);
    await go(root);
    expect(publishSpace).toHaveBeenCalledTimes(1);
    expect(makePublic).toHaveBeenCalledTimes(1);
    expect(putOnMap).toHaveBeenCalledTimes(2);
    expect(text(root, "#step")).toContain(keep.ui.uiOnMapLive);
  });

  it("a map that doesn't answer is the map's silence, not the pod's", async () => {
    const root = open(vi.fn(async () => ok()), { putOnMap: vi.fn(async () => { throw new PublishError("unreachable", "x"); }) });
    await go(root);
    expect(text(root, "#publish-status")).toBe(keep.ui.uiMapDown);
  });
});

describe("the threshold right after the pod was made (Nicolas, live 2026-11-03)", () => {
  it("replaces the pod-ready panel once on the map, and tile A and tile B both show done", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    renderPage(root, tree, {
      mode: "workbench", who: "weld-done", done: new Set(), draft, fold: { folded: false },
      onSignIn: () => {}, onSignOut: () => {}, readOffers: async () => "open",
      podReady: { pod: "https://weld-done.pod.example/", webId: "https://weld-done.pod.example/profile/card#me" },
      publishSpace: vi.fn(async () => ok()),
      makePublic: async (): Promise<PublicResult> => ({ status: "made-public" }),
      putOnMap: vi.fn(async (): Promise<OnMap> => ({ id: "weld-done", link: "https://mapsofmaking.org/?space=weld-done", pin: { id: "weld-done", name: "Weld Done", lat: 50.8, lon: 4.3, city: "Marolles", country: "Belgium" } })),
    } as unknown as Parameters<typeof renderPage>[2]);
    root.querySelector<HTMLElement>("#publish-go")!.click();
    for (let i = 0; i < 4; i++) await settle();
    expect(root.querySelector("#publish-go")).toBeNull();
    expect(text(root, "#step")).toContain(keep.ui.uiOnMapLive);
    expect(root.querySelector('[data-tile="describe"]')!.className).toContain("done");
    expect(root.querySelector('[data-tile="keep"]')!.className).toContain("done");
    root.remove();
  });
});

describe("signed in with the space already on the map (14.4 S4, #14)", () => {
  it("lands on tile C, and tile B opens on the threshold read from the pod and the map", () => {
    const root = document.createElement("div");
    document.body.append(root);
    renderPage(root, tree, {
      mode: "workbench", who: "weld-done", done: new Set(["describe", "keep"]), draft, fold: { folded: false },
      onSignIn: () => {}, onSignOut: () => {}, readOffers: async () => "open",
      publishSpace: vi.fn(async () => ok()), makePublic: async (): Promise<PublicResult> => ({ status: "already-public" }),
      putOnMap: vi.fn(),
      published: { fileUrl: URL_, onMap: { id: "weld-done", link: "https://mapsofmaking.org/?space=weld-done", pin: { id: "weld-done", name: "Weld Done", lat: 50.8, lon: 4.3, city: "Marolles", country: "BE" } } },
    } as unknown as Parameters<typeof renderPage>[2]);
    expect(root.querySelector('[aria-current="step"]')!.getAttribute("data-tile")).toBe("change");
    root.querySelector<HTMLElement>('button[data-tile="keep"]')!.click();
    expect(text(root, "#step")).toContain(keep.ui.uiOnMapLive);
    expect(root.querySelector("#publish-go")).toBeNull();
    root.remove();
  });
});
