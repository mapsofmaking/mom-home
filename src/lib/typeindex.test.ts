import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.mock("./auth", () => ({ authFetch: (...args: unknown[]) => mockFetch(...args) }));
const makePublic = vi.fn();
vi.mock("./publish", () => ({ makePublic: (...a: unknown[]) => makePublic(...a) }));

const { ensureIndexes, insertOnlyPatch, registerSpace, registerType, spacesInPublicIndex, MOM_SPACE, TypeIndexRefused } = await import("./typeindex");
const { forgetReads } = await import("./read");

const POD = "https://weld-done.pod.example/";
const WEBID = POD + "profile/card#me";
const PROFILE = POD + "profile/card";
const PUB = POD + "settings/publicTypeIndex.ttl";
const PRIV = POD + "settings/privateTypeIndex.ttl";
const PREFS = POD + "settings/prefs.ttl";
const SOLID = "http://www.w3.org/ns/solid/terms#";
const PIM = "http://www.w3.org/ns/pim/space#";
const CARD = `<${WEBID}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <https://pod.example/> .\n`;

/** A fake pod: documents by URL with ETags; PATCH appends what an insert-only patch inserts; records every request. */
function pod(docs: Record<string, string>) {
  const store = new Map(Object.entries(docs).map(([k, v]) => [k, { text: v, etag: '"1"' }]));
  const calls: { method: string; url: string; body?: string; headers: Record<string, string> }[] = [];
  mockFetch.mockImplementation(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ method, url, body: init.body ? String(init.body) : undefined, headers });
    const doc = store.get(url);
    if (method === "GET") return doc ? new Response(doc.text, { status: 200, headers: { ETag: doc.etag } }) : new Response("", { status: 404 });
    if (method === "PATCH") {
      if (!doc) return new Response("", { status: 404 });
      const inserted = /solid:inserts \{\n([\s\S]*?)\n {2}\}/.exec(String(init.body))?.[1] ?? "";
      store.set(url, { text: doc.text + inserted + "\n", etag: doc.etag + "+" });
      return new Response(null, { status: 205 });
    }
    if (headers["If-None-Match"] === "*" && doc) return new Response("", { status: 412 });
    if (headers["If-Match"] && (!doc || headers["If-Match"] !== doc.etag)) return new Response("", { status: 412 });
    store.set(url, { text: String(init.body), etag: `"${Number(doc?.etag.replace(/\D/g, "") || 0) + 1}"` });
    return new Response(null, { status: doc ? 204 : 201 });
  });
  return { store, calls };
}

beforeEach(() => {
  mockFetch.mockReset();
  makePublic.mockReset();
  makePublic.mockResolvedValue({ status: "made-public" });
  forgetReads();
});

describe("insertOnlyPatch: the only way home writes a profile", () => {
  it("only inserts: no deletes, no where, so nothing already there can go", () => {
    const patch = insertOnlyPatch([[WEBID, SOLID + "publicTypeIndex", PUB]]);
    expect(patch).toContain("solid:InsertDeletePatch");
    expect(patch).toContain(`<${WEBID}> <${SOLID}publicTypeIndex> <${PUB}>.`);
    expect(patch).not.toMatch(/deletes|where/);
  });

  it("refuses an IRI that could break out of the patch", () => {
    expect(() => insertOnlyPatch([[WEBID, SOLID + "publicTypeIndex", "https://x.example/a> } ; solid:deletes { <x"]])).toThrow(TypeIndexRefused);
  });
});

describe("ensureIndexes (#14): the pod's Type Indexes, made and linked only when missing", () => {
  it("on a pod without them: makes the three files, links the profile insert-only, then opens the public index", async () => {
    const { store, calls } = pod({ [PROFILE]: CARD });
    let patchedBeforeOpening = false;
    makePublic.mockImplementation(async () => {
      patchedBeforeOpening = calls.some((c) => c.url === PROFILE && c.method === "PATCH");
      return { status: "made-public" };
    });
    expect(await ensureIndexes(WEBID, POD, true)).toEqual({ publicIndex: PUB, privateIndex: PRIV });
    expect(store.get(PUB)!.text).toContain("ListedDocument");
    expect(store.get(PRIV)!.text).toContain("UnlistedDocument");
    expect(store.get(PREFS)!.text).toContain(`<${WEBID}> solid:privateTypeIndex <${PRIV}>`);
    for (const url of [PUB, PRIV, PREFS]) expect(calls.find((c) => c.url === url && c.method === "PUT")!.headers["If-None-Match"]).toBe("*");
    expect(makePublic).toHaveBeenCalledWith(PUB, WEBID, expect.objectContaining({ accept: "text/turtle" }));
    // The profile: one PATCH, before the public step, adding exactly the two links; the profile is never PUT.
    const profileWrites = calls.filter((c) => c.url === PROFILE && c.method !== "GET");
    expect(profileWrites.map((c) => c.method)).toEqual(["PATCH"]);
    expect(patchedBeforeOpening).toBe(true);
    expect(store.get(PROFILE)!.text).toContain(CARD.trim());
    expect(store.get(PROFILE)!.text).toContain(`<${SOLID}publicTypeIndex> <${PUB}>`);
    expect(store.get(PROFILE)!.text).toContain(`<${PIM}preferencesFile> <${PREFS}>`);
  });

  it("on a pod that has them (our pod server makes them): the profile isn't touched, nothing is replaced", async () => {
    const { store, calls } = pod({
      [PROFILE]: CARD + `<${WEBID}> <${SOLID}publicTypeIndex> <${PUB}> ; <${PIM}preferencesFile> <${PREFS}> .`,
      [PREFS]: `<${WEBID}> <${SOLID}privateTypeIndex> <${PRIV}> .`,
      [PUB]: "<> a <http://www.w3.org/ns/solid/terms#TypeIndex> . # mine",
      [PRIV]: "# also mine",
    });
    await ensureIndexes(WEBID, POD);
    expect(calls.filter((c) => c.method === "PATCH")).toEqual([]);
    expect(store.get(PUB)!.text).toContain("# mine");
    expect(store.get(PRIV)!.text).toBe("# also mine");
  });

  it("adds only the link that is missing, and the private index to preferences that lack it", async () => {
    const { calls } = pod({ [PROFILE]: CARD + `<${WEBID}> <${PIM}preferencesFile> <${PREFS}> .`, [PREFS]: "<> a <http://www.w3.org/ns/pim/space#ConfigurationFile> ." });
    await ensureIndexes(WEBID, POD);
    const patches = calls.filter((c) => c.method === "PATCH");
    expect(patches.map((p) => p.url)).toEqual([PREFS, PROFILE]);
    expect(patches[1].body).toContain("publicTypeIndex");
    expect(patches[1].body).not.toContain("preferencesFile");
  });

  it("uses a private index the profile names directly (older apps did that)", async () => {
    const other = POD + "settings/myIndex.ttl";
    const { store } = pod({ [PROFILE]: CARD + `<${WEBID}> <${SOLID}privateTypeIndex> <${other}> .`, [other]: "# kept" });
    expect((await ensureIndexes(WEBID, POD)).privateIndex).toBe(other);
    expect(store.get(other)!.text).toBe("# kept");
    expect(store.get(PREFS)!.text).toContain(other);
  });

  it("refuses a profile that isn't on the pod, and links that point off it, before writing anything", async () => {
    const { calls } = pod({ [PROFILE]: CARD + `<${WEBID}> <${SOLID}publicTypeIndex> <https://elsewhere.example/idx.ttl> .` });
    await expect(ensureIndexes("https://me.example/card#me", POD)).rejects.toBeInstanceOf(TypeIndexRefused);
    await expect(ensureIndexes(WEBID, POD)).rejects.toBeInstanceOf(TypeIndexRefused);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
    expect(calls.some((c) => c.url.startsWith("https://elsewhere.example"))).toBe(false);
  });
});

describe("ensureIndexes: what the review of #29 found", () => {
  it("the settings path never touches the public index's rules", async () => {
    pod({ [PROFILE]: CARD });
    await ensureIndexes(WEBID, POD);
    expect(makePublic).not.toHaveBeenCalled();
  });

  it("never widens a public index that was already there and isn't readable by anyone: refused", async () => {
    pod({ [PROFILE]: CARD + `<${WEBID}> <${SOLID}publicTypeIndex> <${PUB}> .`, [PUB]: "# the owner's, private" });
    const anon = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 401 }));
    await expect(ensureIndexes(WEBID, POD, true)).rejects.toBeInstanceOf(TypeIndexRefused);
    expect(makePublic).not.toHaveBeenCalled();
    anon.mockResolvedValue(new Response("<> a <http://www.w3.org/ns/solid/terms#TypeIndex>.", { status: 200 }));
    await expect(ensureIndexes(WEBID, POD, true)).resolves.toMatchObject({ publicIndex: PUB });
    expect(makePublic).not.toHaveBeenCalled();
    anon.mockRestore();
  });

  it("refuses a profile it can't parse, writing nothing (it would add links the profile may have)", async () => {
    const { calls } = pod({ [PROFILE]: "<#me> this is { not turtle" });
    await expect(ensureIndexes(WEBID, POD, true)).rejects.toBeInstanceOf(TypeIndexRefused);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("stays inside the pod's own path: another pod on the same origin is refused (folder layout)", async () => {
    const root = "https://pod.example/alice/";
    const webId = root + "profile/card#me";
    const { calls } = pod({ [root + "profile/card"]: `<${webId}> <${SOLID}publicTypeIndex> <https://pod.example/bob/settings/idx.ttl> .` });
    await expect(ensureIndexes(webId, root, true)).rejects.toBeInstanceOf(TypeIndexRefused);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
    await expect(ensureIndexes("https://pod.example/bob/profile/card#me", root)).rejects.toBeInstanceOf(TypeIndexRefused);
  });

  it("uses a preferences file that is there but unlinked, and adds the private index to it if it lacks it", async () => {
    const { calls, store } = pod({ [PROFILE]: CARD, [PREFS]: "<> a <http://www.w3.org/ns/pim/space#ConfigurationFile> . # mine" });
    await ensureIndexes(WEBID, POD);
    expect(calls.find((c) => c.url === PREFS && c.method === "PATCH")!.body).toContain("privateTypeIndex");
    expect(store.get(PREFS)!.text).toContain("# mine");
  });

  it("refuses a WebID whose document is a folder", async () => {
    pod({});
    await expect(ensureIndexes(POD + "#me", POD)).rejects.toBeInstanceOf(TypeIndexRefused);
  });
});

describe("registerType: home's own entries in an index, never another app's", () => {
  it("adds one registration, once, and keeps everything else", async () => {
    const { store } = pod({ [PUB]: `<${PUB}#theirs> a <${SOLID}TypeRegistration> ; <${SOLID}forClass> <https://x.example/Thing> ; <${SOLID}instance> <https://x.example/t> .` });
    const space = POD + "space.ttl#space";
    await registerType(PUB, MOM_SPACE, space, "mom-space");
    await registerType(PUB, MOM_SPACE, space, "mom-space");
    const text = store.get(PUB)!.text;
    expect(text.split("#mom-space>").length - 1).toBe(1);
    expect(text).toContain("#theirs>");
    expect(text).toContain(`<${SOLID}instance> <${space}>`);
  });

  it("never reuses an id another entry has", async () => {
    const { store } = pod({ [PUB]: `<${PUB}#mom-space> <https://x.example/p> "someone else's" .` });
    await registerType(PUB, MOM_SPACE, POD + "space.ttl#space", "mom-space");
    expect(store.get(PUB)!.text).toContain(`<${PUB}#mom-space-2>`);
  });

  it("leaves a file it would break", async () => {
    const broken = `<${PUB}#a> <${SOLID}instance> <${POD}x> ;`;
    const { store } = pod({ [PUB]: broken });
    await expect(registerType(PUB, MOM_SPACE, POD + "space.ttl#space", "mom-space")).rejects.toThrow();
    expect(store.get(PUB)!.text).toBe(broken);
  });
});

describe("spacesInPublicIndex: where the space is, read at sign-in", () => {
  it("names the spaces the public index lists on the pod's own origin, and nothing elsewhere", async () => {
    pod({
      [PROFILE]: CARD + `<${WEBID}> <${SOLID}publicTypeIndex> <${PUB}> .`,
      [PUB]: `<${PUB}#a> <${SOLID}forClass> <${MOM_SPACE}> ; <${SOLID}instance> <${POD}spaces/weld.ttl#space> .
<${PUB}#b> <${SOLID}forClass> <${MOM_SPACE}> ; <${SOLID}instance> <https://elsewhere.example/s.ttl#space> .
<${PUB}#c> <${SOLID}forClass> <https://x.example/Thing> ; <${SOLID}instance> <${POD}thing.ttl> .`,
    });
    expect(await spacesInPublicIndex(WEBID, POD)).toEqual([`${POD}spaces/weld.ttl#space`]);
  });

  it("ignores entries on the same origin but in another pod (folder layout)", async () => {
    const root = "https://pod.example/alice/";
    const webId = root + "profile/card#me";
    const idx = root + "settings/publicTypeIndex.ttl";
    pod({
      [root + "profile/card"]: `<${webId}> <${SOLID}publicTypeIndex> <${idx}> .`,
      [idx]: `<${idx}#a> <${SOLID}forClass> <${MOM_SPACE}> ; <${SOLID}instance> <https://pod.example/bob/space.ttl#space> .`,
    });
    expect(await spacesInPublicIndex(webId, root)).toEqual([]);
  });

  it("is empty without a public index, or for a profile off the pod", async () => {
    pod({ [PROFILE]: CARD });
    expect(await spacesInPublicIndex(WEBID, POD)).toEqual([]);
    expect(await spacesInPublicIndex("https://me.example/card#me", POD)).toEqual([]);
  });
});

describe("registerSpace", () => {
  it("makes the indexes when missing, then lists the space in the public one", async () => {
    const { store } = pod({ [PROFILE]: CARD });
    await registerSpace(WEBID, POD, POD + "space.ttl#space");
    expect(store.get(PUB)!.text).toContain(`<${SOLID}forClass> <${MOM_SPACE}>`);
    expect(await spacesInPublicIndex(WEBID, POD)).toEqual([POD + "space.ttl#space"]);
  });
});
