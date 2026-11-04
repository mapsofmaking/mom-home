import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HoursResult } from "../lib/hours";
import type { LogoResult } from "../lib/logo";
import type { MoveResult } from "../lib/move";
import type { Found } from "./where";
type LogoUpload = (file: File, current: string | null) => Promise<LogoResult>;
import type { MapReread } from "../lib/onmap";
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

function open(saveHours: (h: string) => Promise<HoursResult>, draft: Draft = { name: "Weld Done", city: "Marolles", country: "BE", lat: "50.8", lon: "4.3" }, mapRead?: (h: string) => Promise<MapReread>) {
  const root = document.createElement("div");
  document.body.append(root);
  renderPage(root, tree, {
    mode: "workbench", who: "weld-done", done: new Set(["describe", "keep"]), draft, fold: { folded: false },
    onSignIn: () => {}, onSignOut: () => {}, readOffers: async () => "open", saveHours, mapRead: mapRead as never,
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
    const saveHours = vi.fn(async (h: string): Promise<HoursResult> => ({ status: "saved", was: "Mo 9-12", hours: h, text: "" }));
    const root = open(saveHours);
    type(root, "Tu-Fr 12:00-20:00");
    root.querySelector<HTMLElement>("#hours-save")?.click();
    await settle();
    expect(saveHours).toHaveBeenCalledTimes(1);
    expect(text(root, "#hours-was")).toBe(`${change.ui.uiHoursLabel} ${change.ui.uiHoursWas.replace("{was}", "Mo 9-12")}`);
    expect(text(root, "pre.wb-file .chg")).toBe('schema:openingHours "Tu-Fr 12:00-20:00" ;');
    expect(root.querySelector('[data-tile="change"]')!.className).toContain("done");
    root.remove();
  });

  it("the same hours: said plainly, not as an error, nothing marked done", async () => {
    const root = open(vi.fn(async (h: string): Promise<HoursResult> => ({ status: "same", was: h, hours: h, text: "" })));
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
      [new PublishError("no-control", "x", 403), change.ui.uiHoursNoAccess],
      [new PublishError("unconfirmed", "x"), change.ui.uiHoursUnconfirmed],
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
    finish({ status: "saved", was: null, hours: "Mo 9-17", text: "" });
    await settle();
    expect(text(root, "#hours-was")).toBe(change.ui.uiHoursNew);
    root.remove();
  });

  it("Back to your tiles leaves tile C; reopened, it is the field again with the saved hours (C3)", async () => {
    const root = open(vi.fn(async (h: string): Promise<HoursResult> => ({ status: "saved", was: null, hours: h, text: "" })));
    type(root, "Mo 9-17");
    await settle();
    root.querySelector<HTMLElement>("#hours-back")!.click();
    expect(root.querySelector(".wb-step-title")!.textContent).not.toBe(change.title);
    root.querySelector<HTMLElement>('button[data-tile="change"]')!.click();
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

describe("the map reads it now; file and card (14.6 S2, #37)", () => {
  const saved = async (h: string): Promise<HoursResult> => ({ status: "saved", was: "Mo 9-12", hours: h, text: "" });
  const reread = (hours: string, caughtUp = true): MapReread => ({
    caughtUp,
    onMap: { id: "weld-done", link: "https://mapsofmaking.org/?space=weld-done", pin: { id: "weld-done", name: "Weld Done", lat: 50.8, lon: 4.3, city: "Marolles", country: "BE", hours, address: "Rue de l'Étincelle 12", logo: "" } },
  });

  it("after the save the map reads it: the steps tick, then the card shows the new hours beside the file", async () => {
    let finish!: (r: MapReread) => void;
    const mapRead = vi.fn(() => new Promise<MapReread>((r) => { finish = r; }));
    const root = open(vi.fn(saved), undefined, mapRead);
    type(root, "Mo 9-17");
    await settle();
    expect(mapRead).toHaveBeenCalledWith("Mo 9-17");
    expect(text(root, "#hours-map")).toContain(change.ui.uiStepWritten);
    expect(text(root, "#hours-map")).toContain(change.ui.uiStepMapReading);
    finish(reread("Mo 9-17"));
    await settle();
    expect(text(root, "#hours-map")).toContain(change.ui.uiStepMapRead);
    expect(text(root, "#hours-map-status")).toBe(change.ui.uiReloadHint);
    expect(text(root, ".wb-flow-card .pv-facts dd.hit")).toBe("Mo 9-17");
    expect(root.querySelector(".wb-flow .wb-flow-file ~ .wb-flow-card")).not.toBeNull();
    root.remove();
  });

  it("late: the map took it, the card still shows what it had, said plainly", async () => {
    const root = open(vi.fn(saved), undefined, vi.fn(async () => reread("Mo 9-12", false)));
    type(root, "Mo 9-17");
    await settle(); await settle();
    expect(text(root, "#hours-map")).toContain(change.ui.uiStepMapLate);
    expect(text(root, ".wb-flow-card .pv-facts dd.hit")).toBe("Mo 9-12");
    root.remove();
  });

  it("the map's failure is its own: the file has the hours, and the button asks the map again", async () => {
    let n = 0;
    const mapRead = vi.fn(async (h: string) => { if (n++ === 0) throw new PublishError("map-down", "x", 502); return reread(h); });
    const root = open(vi.fn(saved), undefined, mapRead);
    type(root, "Mo 9-17");
    await settle(); await settle();
    expect(text(root, "#hours-map-status")).toBe(change.ui.uiMapDidntRead);
    expect(root.querySelector('[data-tile="change"]')!.className).toContain("done");
    root.querySelector<HTMLElement>("#hours-map-again")!.click();
    await settle(); await settle();
    expect(mapRead).toHaveBeenCalledTimes(2);
    expect(text(root, "#hours-map")).toContain(change.ui.uiStepMapRead);
    root.remove();
  });

  it("a map that refused the file says so in its own words", async () => {
    const root = open(vi.fn(saved), undefined, vi.fn(async () => { throw new PublishError("map-refused", "x", 422); }));
    type(root, "Mo 9-17");
    await settle(); await settle();
    expect(text(root, "#hours-map-status")).toBe(change.ui.uiMapRefusedFile);
    root.remove();
  });

  it("the tiles don't wait for the map, and its answer never redraws another tile", async () => {
    let finish!: (r: MapReread) => void;
    const root = open(vi.fn(saved), undefined, vi.fn(() => new Promise<MapReread>((r) => { finish = r; })));
    type(root, "Mo 9-17");
    await settle();
    root.querySelector<HTMLElement>('button[data-tile="describe"]')!.click();
    const title = root.querySelector(".wb-step-title");
    expect(title!.textContent).not.toBe(change.title);
    finish(reread("Mo 9-17"));
    await settle();
    expect(root.querySelector(".wb-step-title")).toBe(title);
    root.remove();
  });
});

describe("tile C follows the storyboard: C1 before, C2 while the map reads (14.6 S2)", () => {
  const FILE_TEXT = `@prefix schema: <https://schema.org/> .\n<#space> a mom:Space ;\n  schema:name "Weld Done" ;\n  schema:openingHours "Mo 9-12" .\n`;
  const onMap = (hours: string) => ({ id: "weld-done", link: "https://mapsofmaking.org/?space=weld-done", pin: { id: "weld-done", name: "Weld Done", lat: 50.8, lon: 4.3, city: "Marolles", country: "BE", hours, address: "Rue de l'Étincelle 12" } });
  const mount = (extra: Record<string, unknown>) => {
    const root = document.createElement("div");
    document.body.append(root);
    renderPage(root, tree, {
      mode: "workbench", who: "weld-done", done: new Set(["describe", "keep"]), draft: { name: "Weld Done", hours: "Mo 9-12" }, fold: { folded: false },
      onSignIn: () => {}, onSignOut: () => {}, readOffers: async () => "open",
      published: { fileUrl: "https://weld-done.pod.example/space.ttl", onMap: onMap("Mo 9-12") }, spaceText: FILE_TEXT, ...extra,
    } as Parameters<typeof renderPage>[2]);
    root.querySelector<HTMLElement>('button[data-tile="change"]')!.click();
    return root;
  };

  it("C1: before saving, the pod's file (every line, the hours marked), an arrow, then the card the map holds", () => {
    const root = mount({ saveHours: vi.fn() });
    expect(root.querySelectorAll("pre.wb-file .line")).toHaveLength(4);
    expect(text(root, "pre.wb-file .chg")).toBe('schema:openingHours "Mo 9-12" .');
    expect(root.querySelector(".wb-flow-arrow")).not.toBeNull();
    expect(text(root, ".wb-facts-box dd.hit")).toBe("Mo 9-12");
    expect(text(root, ".wb-facts-box dd")).toBe("Rue de l'Étincelle 12");
    root.remove();
  });

  it("C2: saved, the file read back says the new hours while the card still says the old ones", async () => {
    const after = FILE_TEXT.replace("Mo 9-12", "Mo 9-17");
    const root = mount({
      saveHours: vi.fn(async (h: string): Promise<HoursResult> => ({ status: "saved", was: "Mo 9-12", hours: h, text: after })),
      mapRead: vi.fn(() => new Promise<MapReread>(() => {})),
    });
    type(root, "Mo 9-17");
    await settle();
    expect(text(root, "pre.wb-file .chg")).toBe('schema:openingHours "Mo 9-17" .');
    expect(text(root, ".wb-facts-box dd.hit")).toBe("Mo 9-12");
    expect(text(root, "#hours-map")).toContain(change.ui.uiStepMapReadingWhy);
    expect(root.querySelector("#hours-back")).toBeNull();
    root.remove();
  });
});

describe("the logo, once the hours are in the file (14.6 S6, #41)", () => {
  const LOGO = "https://weld-done.pod.example/logo";
  const pinWith = (logo: string) => ({ id: "weld-done", name: "Weld Done", lat: 50.8, lon: 4.3, city: "Marolles", country: "BE", hours: "Mo 9-17", address: "", logo });
  const result = (status: "saved" | "same", url = LOGO): LogoResult => ({ status, was: null, text: `<#space> <https://schema.org/logo> <${url}> .`, url, opened: "made-public" });

  function visit(hours: string | undefined, opts: { upload?: LogoUpload; address?: (t: string) => Promise<LogoResult>; mapRead?: (s: unknown) => Promise<MapReread> } = {}) {
    const root = document.createElement("div");
    document.body.append(root);
    const upload = vi.fn(opts.upload ?? (async () => result("saved")));
    const address = vi.fn(opts.address ?? (async (t: string) => result("saved", t)));
    const mapRead = vi.fn(opts.mapRead ?? (async () => ({ caughtUp: true, onMap: { id: "weld-done", link: "", pin: pinWith(LOGO) } })));
    const draft: Draft = { name: "Weld Done", city: "Marolles", country: "BE", lat: "50.8", lon: "4.3", ...(hours ? { hours } : {}) };
    renderPage(root, tree, {
      mode: "workbench", who: "weld-done", done: new Set(["describe", "keep"]), draft, fold: { folded: false },
      onSignIn: () => {}, onSignOut: () => {}, readOffers: async () => "open", saveHours: vi.fn(), mapRead: mapRead as never,
      uploadLogo: upload, useLogoAddress: address,
    });
    root.querySelector<HTMLElement>('button[data-tile="change"]')!.click();
    return { root, upload, address, mapRead, draft };
  }
  const pick = (root: HTMLElement, file: File) => {
    const input = root.querySelector<HTMLInputElement>("#logo-file")!;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "logo.png", { type: "image/png" });

  it("the first time is the hours only; with hours in the file, the logo panel shows below them", () => {
    const first = visit(undefined);
    expect(first.root.querySelector("#logo")).toBeNull();
    first.root.remove();
    const later = visit("Mo 9-17");
    expect(text(later.root, "#logo-pick")).toBe(change.ui.uiLogoUpload);
    expect(later.root.querySelector<HTMLInputElement>("#logo-file")!.accept).toBe("image/png,image/jpeg,image/webp");
    later.root.remove();
  });

  it("an upload: the file shows its logo line, the map reads the new address, and the card shows it as an image", async () => {
    const { root, upload, mapRead, draft } = visit("Mo 9-17");
    pick(root, png());
    await settle(); await settle();
    expect(upload).toHaveBeenCalledWith(expect.any(File), null);
    expect(draft.logo).toBe(LOGO);
    expect(text(root, "#logo-status")).toContain(change.ui.uiLogoSaved);
    expect(text(root, "#logo-status")).toContain(change.ui.uiLogoMapRead);
    const says = mapRead.mock.calls[0][0] as (p: ReturnType<typeof pinWith>) => boolean;
    expect(says(pinWith(LOGO))).toBe(true);
    expect(says(pinWith(""))).toBe(false);
    expect(root.querySelector("pre.wb-file .chg")!.textContent).toContain("logo");
    // The card is the embed's: the logo beside the name, top right; not a fact of its own.
    const img = root.querySelector<HTMLImageElement>(".wb-popup .sp-name-row .sp-logo img")!;
    expect(img.getAttribute("src")).toBe(LOGO);
    expect(root.querySelector(".wb-facts-box img")).toBeNull();
    // An image that fails to load becomes the map's placeholder.
    img.dispatchEvent(new Event("error"));
    expect(root.querySelector(".wb-popup .sp-logo.is-placeholder svg")).not.toBeNull();
    expect(root.querySelector(".wb-popup .sp-logo img")).toBeNull();
    root.remove();
  });

  it("replaced at the same address: said so, and the map has nothing new to read", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
    const { root, mapRead } = visit("Mo 9-17", { upload: async () => result("same") });
    pick(root, png());
    await settle(); await settle();
    expect(text(root, "#logo-status")).toBe(change.ui.uiLogoReplaced);
    expect(mapRead).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith(LOGO, expect.objectContaining({ cache: "reload" }));
    fetchSpy.mockRestore();
    root.remove();
  });

  it("each refusal has its own line, and nothing else changes", async () => {
    for (const [code, key] of [["too-large", "uiLogoTooLarge"], ["not-image", "uiLogoNotImage"], ["taken", "uiLogoTaken"], ["not-public", "uiLogoNotPublic"]] as const) {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { root, mapRead, draft } = visit("Mo 9-17", { upload: async () => { throw new PublishError(code, code); } });
      pick(root, png());
      await settle(); await settle();
      expect(text(root, "#logo-status")).toBe(change.ui[key]);
      expect(root.querySelector("#logo-status")!.classList.contains("is-error")).toBe(true);
      expect(mapRead).not.toHaveBeenCalled();
      expect(draft.logo).toBeUndefined();
      warn.mockRestore();
      root.remove();
    }
  });

  it("an address already online goes through its own call, and a bad one is said in its own words", async () => {
    const { root, address, upload } = visit("Mo 9-17", { address: async () => { throw new PublishError("not-image", "x"); } });
    root.querySelector<HTMLInputElement>("#f-logo-url")!.value = "weld.example/logo.png";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    root.querySelector<HTMLElement>("#logo-use")!.click();
    await settle(); await settle();
    warn.mockRestore();
    expect(address).toHaveBeenCalledWith("weld.example/logo.png");
    expect(upload).not.toHaveBeenCalled();
    expect(text(root, "#logo-status")).toBe(change.ui.uiLogoBadAddress);
    // What was typed stays.
    expect(root.querySelector<HTMLInputElement>("#f-logo-url")!.value).toBe("weld.example/logo.png");
    root.remove();
  });
});

describe("tile C, a space that moves (14.6 S5, #40)", () => {
  const FOUND = { answer: { lat: 50.8301, lon: 4.3801, country_code: "be", postcode: "1050", display_name: "158, Rue Gray - Grijsstraat, Ixelles - Elsene, Brussels" }, missed: false };
  const moved = (over: Partial<MoveResult> = {}): MoveResult => ({
    status: "saved",
    was: { street: "Rue Haute 12", postcode: "1000", city: "Marolles", country: "BE", lat: 50.8, lon: 4.3 },
    now: { street: "158 Rue Gray", postcode: "1050", city: "Ixelles", country: "BE", lat: 50.8301, lon: 4.3801 },
    text: `<#space> <https://schema.org/address> [ <https://schema.org/streetAddress> "158 Rue Gray" ] .`,
    ...over,
  });
  const pin = (lat: number, lon: number) => ({ id: "weld-done", name: "Weld Done", lat, lon, city: "Ixelles", country: "BE", hours: "Mo 9-17", address: "", logo: "" });

  function visit(opts: { found?: Found; move?: () => Promise<MoveResult>; hours?: string } = {}) {
    const root = document.createElement("div");
    document.body.append(root);
    const findPlace = vi.fn(async () => opts.found ?? (FOUND as Found));
    const moveSpace = vi.fn(opts.move ?? (async () => moved()));
    const mapRead = vi.fn(async () => ({ caughtUp: true, onMap: { id: "weld-done", link: "", pin: pin(50.8301, 4.3801) } }));
    const draft: Draft = { name: "Weld Done", street: "Rue Haute 12", city: "Marolles", country: "BE", lat: "50.8", lon: "4.3", hours: opts.hours ?? "Mo 9-17" };
    renderPage(root, tree, {
      mode: "workbench", who: "weld-done", done: new Set(["describe", "keep"]), draft, fold: { folded: false },
      onSignIn: () => {}, onSignOut: () => {}, readOffers: async () => "open", saveHours: vi.fn(), mapRead: mapRead as never,
      moveSpace, findPlace: findPlace as never,
    });
    root.querySelector<HTMLElement>('button[data-tile="change"]')!.click();
    return { root, findPlace, moveSpace, mapRead, draft };
  }
  const type = (root: HTMLElement, street: string, city: string) => {
    root.querySelector<HTMLInputElement>("#f-move-street")!.value = street;
    root.querySelector<HTMLInputElement>("#f-move-city")!.value = city;
    root.querySelector<HTMLFormElement>("#f-move")!.requestSubmit();
  };

  it("shown once the hours are in the file, prefilled with the street and city the file says", () => {
    const { root } = visit();
    expect(root.querySelector<HTMLInputElement>("#f-move-street")!.value).toBe("Rue Haute 12");
    expect(root.querySelector<HTMLInputElement>("#f-move-city")!.value).toBe("Marolles");
    expect(text(root, "#move-save")).toBe(change.ui.uiMoveSave);
    root.remove();
  });

  it("placed first, then the address and the pin written together; the steps tick, the result names the move", async () => {
    const { root, findPlace, moveSpace, mapRead, draft } = visit();
    type(root, " 158 Rue Gray ", "Ixelles");
    await settle(); await settle(); await settle();
    expect(findPlace).toHaveBeenCalledWith("158 Rue Gray", "Ixelles");
    expect(moveSpace).toHaveBeenCalledWith({ street: "158 Rue Gray", postcode: "1050", city: "Ixelles", country: "BE", lat: 50.8301, lon: 4.3801 });
    const steps = text(root, "#move-steps");
    // The place found is shown, so a wrong match shows.
    expect(steps).toContain(change.ui.uiMoveFound.replace("{place}", "158, Rue Gray, Ixelles"));
    expect(steps).toContain(change.ui.uiMoveWritten);
    expect(steps).toContain(change.ui.uiStepMapRead);
    expect(text(root, "#move-status")).toBe(change.ui.uiMoveDone.replace("{was}", "Rue Haute 12"));
    // The map's pin is what's checked, not its address line.
    const says = (mapRead.mock.calls[0] as unknown[])[0] as (p: ReturnType<typeof pin>) => boolean;
    expect(says(pin(50.8301, 4.3801))).toBe(true);
    expect(says(pin(50.8, 4.3))).toBe(false);
    expect(draft).toMatchObject({ street: "158 Rue Gray", city: "Ixelles", postcode: "1050", lat: "50.8301", lon: "4.3801" });
    expect(root.querySelector("pre.wb-file .chg")!.textContent).toContain("streetAddress");
    root.remove();
  });

  it("an address the geocoder can't place is refused before anything is written, naming it; what was typed stays", async () => {
    for (const [found, key] of [["none", "uiMoveNoPlace"], ["rate", "uiMoveRate"], ["unavailable", "uiMoveUnavailable"]] as const) {
      const { root, moveSpace } = visit({ found });
      type(root, "Nowhere 1", "Atlantis");
      await settle(); await settle();
      expect(moveSpace).not.toHaveBeenCalled();
      expect(text(root, "#move-status")).toBe(change.ui[key]);
      expect(root.querySelector("#move-status")!.className).toContain("is-error");
      expect(root.querySelector<HTMLInputElement>("#f-move-street")!.value).toBe("Nowhere 1");
      expect(root.querySelector<HTMLInputElement>("#f-move-city")!.value).toBe("Atlantis");
      root.remove();
    }
    expect(change.ui.uiMoveNoPlace).toContain("geocoder");
  });

  it("a place without a country is refused too; no city asks for one", async () => {
    const { root, moveSpace } = visit({ found: { answer: { ...FOUND.answer, country_code: null }, missed: false } as Found });
    type(root, "158 Rue Gray", "Ixelles");
    await settle(); await settle();
    expect(moveSpace).not.toHaveBeenCalled();
    expect(text(root, "#move-status")).toBe(change.ui.uiMoveNoPlace);
    type(root, "158 Rue Gray", "  ");
    await settle();
    expect(text(root, "#move-status")).toBe(change.ui.uiMoveEmpty);
    expect(document.activeElement?.id).toBe("f-move-city");
    root.remove();
  });

  it("the street not found: the step says the pin sits in the city's centre", async () => {
    const { root } = visit({ found: { ...FOUND, missed: true } as Found });
    type(root, "Nope 9", "Ixelles");
    await settle(); await settle(); await settle();
    expect(text(root, "#move-steps")).toContain(change.ui.uiMoveStreetMissed.replace("{city}", "Ixelles"));
    root.remove();
  });

  it("the pod refusing says why, with the place found kept on screen", async () => {
    const { root } = visit({ move: async () => { throw new PublishError("conflict", "changed"); } });
    type(root, "158 Rue Gray", "Ixelles");
    await settle(); await settle(); await settle();
    expect(text(root, "#move-status")).toBe(change.ui.uiMoveConflict);
    expect(text(root, "#move-steps")).toContain("158, Rue Gray, Ixelles");
    expect(text(root, "#move-steps")).not.toContain(change.ui.uiMoveWritten);
    root.remove();
  });

  it("the same place: said plainly, nothing for the map to read", async () => {
    const { root, mapRead } = visit({ move: async () => moved({ status: "same" }) });
    type(root, "Rue Haute 12", "Marolles");
    await settle(); await settle(); await settle();
    expect(text(root, "#move-status")).toBe(change.ui.uiMoveSame);
    expect(mapRead).not.toHaveBeenCalled();
    root.remove();
  });

  it("the first time, the hours only: no address panel", () => {
    const root = document.createElement("div");
    document.body.append(root);
    renderPage(root, tree, {
      mode: "workbench", who: "weld-done", done: new Set(["describe", "keep"]), draft: { name: "W", city: "Marolles" }, fold: { folded: false },
      onSignIn: () => {}, onSignOut: () => {}, readOffers: async () => "open", saveHours: vi.fn(), moveSpace: vi.fn(),
    });
    root.querySelector<HTMLElement>('button[data-tile="change"]')!.click();
    expect(root.querySelector("#move")).toBeNull();
    root.remove();
  });
});

describe("tile C, a move's late map answer (S5 review)", () => {
  it("doesn't wipe a second address being typed: only the steps tick", async () => {
    let answer!: (v: unknown) => void;
    const root = document.createElement("div");
    document.body.append(root);
    const found = { answer: { lat: 50.83, lon: 4.38, country_code: "be", postcode: "1050", display_name: "Ixelles" }, missed: false };
    const moved: MoveResult = {
      status: "saved", was: { street: "A 1", postcode: "", city: "Marolles", country: "BE", lat: 50.8, lon: 4.3 },
      now: { street: "B 2", postcode: "1050", city: "Ixelles", country: "BE", lat: 50.83, lon: 4.38 }, text: "<#space> <https://schema.org/name> \"W\" .",
    };
    renderPage(root, tree, {
      mode: "workbench", who: "weld-done", done: new Set(["describe", "keep"]), draft: { name: "W", city: "Marolles", hours: "Mo 9-17" }, fold: { folded: false },
      onSignIn: () => {}, onSignOut: () => {}, readOffers: async () => "open", saveHours: vi.fn(),
      mapRead: (() => new Promise((r) => (answer = r))) as never, moveSpace: async () => moved, findPlace: (async () => found) as never,
    });
    root.querySelector<HTMLElement>('button[data-tile="change"]')!.click();
    root.querySelector<HTMLInputElement>("#f-move-street")!.value = "B 2";
    root.querySelector<HTMLInputElement>("#f-move-city")!.value = "Ixelles";
    root.querySelector<HTMLFormElement>("#f-move")!.requestSubmit();
    await settle(); await settle(); await settle();
    const street = root.querySelector<HTMLInputElement>("#f-move-street")!;
    street.focus();
    street.value = "C 3, typing";
    answer({ caughtUp: true, onMap: { id: "w", link: "", pin: { id: "w", name: "W", lat: 50.83, lon: 4.38, city: "", country: "", hours: "", address: "", logo: "" } } });
    await settle(); await settle();
    expect(root.querySelector<HTMLInputElement>("#f-move-street")).toBe(street);
    expect(street.value).toBe("C 3, typing");
    expect(text(root, "#move-steps")).toContain(change.ui.uiStepMapRead);
    root.remove();
  });
});
