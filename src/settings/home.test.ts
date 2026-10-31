import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.mock("../lib/auth", () => ({ authFetch: (...args: unknown[]) => mockFetch(...args) }));

const {
  changeHomeSettings,
  parseHomeSettings,
  readHomeSettings,
  registrationTurtle,
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

  it("registers the file in the private Type Index, once, when the profile has one", async () => {
    const index = POD + "settings/privateTypeIndex.ttl";
    const profile = `<${WEBID}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${index}> .`;
    const store = pod({ [WEBID.split("#")[0]]: profile, [index]: "<> a <http://www.w3.org/ns/solid/terms#TypeIndex> ." });
    await changeHomeSettings(POD, WEBID, (s) => ({ ...s, folded: true }));
    expect(store.get(index)!.text).toContain(registrationTurtle(index, URL).trim());
    // A second first-write (say, after the file was deleted) doesn't list it twice.
    store.delete(URL);
    forgetReads();
    await changeHomeSettings(POD, WEBID, (s) => ({ ...s, folded: false }));
    expect(store.get(index)!.text.split("mom-home-settings").length - 1).toBe(1);
  });

  it("finds the Type Index through the preferences file, and skips it when there is none", async () => {
    const prefs = POD + "settings/prefs.ttl";
    const index = POD + "settings/privateTypeIndex.ttl";
    const store = pod({
      [WEBID.split("#")[0]]: `<${WEBID}> <http://www.w3.org/ns/pim/space#preferencesFile> <${prefs}> .`,
      [prefs]: `<${WEBID}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${index}> .`,
      [index]: "",
    });
    await changeHomeSettings(POD, WEBID, (s) => ({ ...s, folded: true }));
    expect(store.get(index)!.text).toContain("TypeRegistration");

    const bare = pod({ [WEBID.split("#")[0]]: "" });
    forgetReads();
    await changeHomeSettings(POD, WEBID, (s) => ({ ...s, folded: true }));
    expect([...bare.keys()].sort()).toEqual([WEBID.split("#")[0], POD + "settings/README.md", URL].sort());
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
    expect([...(await readDone(tree, { webId: WEBID, podRoot: POD, space: card }))].sort()).toEqual(["describe", "keep"]);
  });

  it("counts a check that fails as not done", async () => {
    const t = { ...tree, tiles: tree.tiles.filter((x) => x.id === "keep") };
    const original = DONE_CHECKS.keep;
    (DONE_CHECKS as Record<string, unknown>).keep = async () => {
      throw new Error("pod down");
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect([...(await readDone(t, { webId: WEBID, podRoot: POD, space: POD + "space.ttl#space" }))]).toEqual([]);
    (DONE_CHECKS as Record<string, unknown>).keep = original;
    warn.mockRestore();
  });
});
