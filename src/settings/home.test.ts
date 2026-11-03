import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.mock("../lib/auth", () => ({ authFetch: (...args: unknown[]) => mockFetch(...args) }));
const ensureIndexes = vi.fn();
const registerType = vi.fn();
vi.mock("../lib/typeindex", () => ({ ensureIndexes: (...a: unknown[]) => ensureIndexes(...a), registerType: (...a: unknown[]) => registerType(...a) }));

const {
  changeHomeSettings,
  homeSettingsUrl,
  parseHomeSettings,
  readHomeSettings,
  serializeHomeSettings,
  SETTINGS_README,
} = await import("./home");
const { forgetReads } = await import("../lib/read");
const { readDone, DONE_CHECKS } = await import("../tiles/done");
const { parseTree } = await import("../tree/parse");
const { readFileSync } = await import("node:fs");
const { join } = await import("node:path");

const POD = "https://atelier.pod.example/";
const WEBID = POD + "profile/card#me";
const URL = POD + "settings/mom-home.ttl";
const CHANGE = "https://mapsofmaking.org/onboarding/space-coordinator#change";

/** A fake pod: documents by URL, with ETags; records every request. */
function pod(docs: Record<string, string>) {
  const store = new Map(Object.entries(docs).map(([k, v]) => [k, { text: v, etag: '"1"' }]));
  mockFetch.mockImplementation(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const headers = (init.headers ?? {}) as Record<string, string>;
    const doc = store.get(url);
    if (method === "GET") {
      if (!doc) return new Response("", { status: 404 });
      return new Response(doc.text, { status: 200, headers: { ETag: doc.etag } });
    }
    if (headers["If-None-Match"] === "*" && doc) return new Response("", { status: 412 });
    if (headers["If-Match"] && (!doc || headers["If-Match"] !== doc.etag)) return new Response("", { status: 412 });
    store.set(url, { text: String(init.body), etag: `"${Number(doc?.etag.replace(/"/g, "") ?? 0) + 1}"` });
    return new Response(null, { status: doc ? 204 : 201 });
  });
  return store;
}

const puts = () => mockFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT");

beforeEach(() => {
  mockFetch.mockReset();
  forgetReads();
});

describe("settings/mom-home.ttl, the document", () => {
  it("round-trips the fold and the tutorials seen", () => {
    const text = serializeHomeSettings({ folded: true, seen: [CHANGE] }, URL);
    expect(parseHomeSettings(text, URL)).toEqual({ folded: true, seen: [CHANGE] });
    expect(parseHomeSettings(serializeHomeSettings({ folded: null, seen: [] }, URL), URL)).toEqual({ folded: null, seen: [] });
  });

  it("never keeps what is done: only the fold and the tutorials", () => {
    const text = serializeHomeSettings({ folded: false, seen: [CHANGE] }, URL);
    expect(text).not.toMatch(/done/i);
  });
});

describe("reading and changing it on the pod", () => {
  it("reads the defaults when there is no file yet", async () => {
    pod({});
    expect(await readHomeSettings(POD)).toEqual({ folded: null, seen: [] });
  });

  it("creates it on first need, only if nobody did, with the README beside it", async () => {
    const store = pod({ [WEBID.split("#")[0]]: "" });
    await changeHomeSettings(POD, WEBID, (s) => ({ ...s, folded: true }));
    const [first, readme] = puts();
    expect(first[0]).toBe(URL);
    expect((first[1] as RequestInit).headers).toMatchObject({ "If-None-Match": "*" });
    expect(readme[0]).toBe(POD + "settings/README.md");
    expect(store.get(POD + "settings/README.md")!.text).toBe(SETTINGS_README);
    expect(parseHomeSettings(store.get(URL)!.text, URL).folded).toBe(true);
  });

  it("never writes over a README already there", async () => {
    const store = pod({ [POD + "settings/README.md"]: "mine", [WEBID.split("#")[0]]: "" });
    await changeHomeSettings(POD, WEBID, (s) => ({ ...s, folded: true }));
    expect(store.get(POD + "settings/README.md")!.text).toBe("mine");
  });

  it("changes an existing file with one conditional whole-document write", async () => {
    const store = pod({ [URL]: serializeHomeSettings({ folded: true, seen: [CHANGE] }, URL) });
    await changeHomeSettings(POD, WEBID, (s) => ({ ...s, folded: false }));
    expect(puts()).toHaveLength(1);
    expect((puts()[0][1] as RequestInit).headers).toMatchObject({ "If-Match": '"1"' });
    expect(parseHomeSettings(store.get(URL)!.text, URL)).toEqual({ folded: false, seen: [CHANGE] });
  });

  it("builds the URL from a pod root without its closing slash", async () => {
    pod({});
    expect(homeSettingsUrl("https://atelier.pod.example")).toBe(URL);
  });

  it("keeps what it doesn't own when it rewrites the file", () => {
    const mine = serializeHomeSettings({ folded: true, seen: [] }, URL);
    const withOther = mine + `\n<${URL}#other> <https://example.org/x> "kept" .\n<${URL}#settings> <https://example.org/y> "also kept" .\n`;
    const out = serializeHomeSettings({ folded: false, seen: [] }, URL, withOther);
    expect(out).toContain("kept");
    expect(out).toContain("also kept");
    expect(parseHomeSettings(out, URL).folded).toBe(false);
  });

  it("leaves a file it can't read, or that isn't its own, alone", async () => {
    const store = pod({ [URL]: "this is not turtle" });
    await expect(changeHomeSettings(POD, WEBID, (s) => ({ ...s, folded: true }))).rejects.toMatchObject({ name: "SettingsUnreadable" });
    expect(store.get(URL)!.text).toBe("this is not turtle");
    const foreign = pod({ [URL]: `<${URL}#x> <https://example.org/y> "mine" .` });
    await expect(changeHomeSettings(POD, WEBID, (s) => ({ ...s, folded: true }))).rejects.toMatchObject({ name: "SettingsUnreadable" });
    expect(foreign.get(URL)!.text).toContain("mine");
  });

  it("tries a creation again once, not for ever", async () => {
    mockFetch.mockImplementation(async (_url: string, init: RequestInit = {}) =>
      (init.method ?? "GET") === "GET" ? new Response("", { status: 404 }) : new Response("", { status: 412 })
    );
    await expect(changeHomeSettings(POD, WEBID, (s) => ({ ...s, folded: true }))).rejects.toThrow();
    expect(puts()).toHaveLength(2);
  });

  it("registers the new file in the private Type Index (lib/typeindex.ts), once it is written", async () => {
    pod({});
    const index = POD + "settings/privateTypeIndex.ttl";
    ensureIndexes.mockResolvedValue({ publicIndex: POD + "settings/publicTypeIndex.ttl", privateIndex: index });
    registerType.mockResolvedValue(undefined);
    await changeHomeSettings(POD, WEBID, (s) => ({ ...s, folded: true }));
    expect(ensureIndexes).toHaveBeenCalledWith(WEBID, POD);
    expect(registerType).toHaveBeenCalledWith(index, expect.stringMatching(/#HomeSettings$/), URL, "mom-home-settings");
  });

  it("keeps the settings when the registration fails: it was written, nothing may report it lost", async () => {
    const store = pod({});
    ensureIndexes.mockRejectedValue(new Error("profile elsewhere"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await changeHomeSettings(POD, WEBID, (s) => ({ ...s, folded: true }));
    warn.mockRestore();
    expect(parseHomeSettings(store.get(URL)!.text, URL).folded).toBe(true);
  });
});

describe("done, read from the pod (AC4)", () => {
  const tree = parseTree(readFileSync(join(__dirname, "../../public/onboarding.ttl"), "utf8"));

  it("has a check for every tile that can open; stubs never guess", async () => {
    const open = tree.tiles.filter((t) => !t.emergent && !t.planned).map((t) => t.id);
    expect(Object.keys(DONE_CHECKS).sort()).toEqual(open.sort());
    // A pod is not a published space: a person's own pod has storage too.
    expect([...(await readDone(tree, { webId: WEBID, podRoot: POD, space: null }))]).toEqual([]);
    const card = POD + "space.ttl#space";
    // A space IRI alone proves nothing: tile A wants what the file says (#11), tile B the map (S3).
    expect([...(await readDone(tree, { webId: WEBID, podRoot: POD, space: card }))]).toEqual([]);
    const spaceData = { name: "Weld Done", city: "Marolles", lat: "50.8", lon: "4.3" };
    expect([...(await readDone(tree, { webId: WEBID, podRoot: POD, space: card, spaceData }))]).toEqual(["describe"]);
    expect([...(await readDone(tree, { webId: WEBID, podRoot: POD, space: card, spaceData, onMap: true }))].sort()).toEqual(["describe", "keep"]);
  });

  it("counts a check that fails as not done", async () => {
    const t = { ...tree, tiles: tree.tiles.filter((x) => x.id === "keep") };
    const original = DONE_CHECKS.keep;
    (DONE_CHECKS as Record<string, unknown>).keep = async () => {
      throw new Error("pod down");
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect([...(await readDone(t, { webId: WEBID, podRoot: POD, space: POD + "space.ttl#space" }))]).toEqual([]);
    } finally {
      (DONE_CHECKS as Record<string, unknown>).keep = original;
      warn.mockRestore();
    }
  });

  it("finds no check for an inherited name like constructor", async () => {
    const t = { ...tree, tiles: [{ ...tree.tiles[0], id: "constructor" }] };
    expect([...(await readDone(t, { webId: WEBID, podRoot: POD, space: POD + "space.ttl#space" }))]).toEqual([]);
  });
});
