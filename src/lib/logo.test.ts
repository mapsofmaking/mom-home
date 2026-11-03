import { Parser, Store, Writer, type Quad } from "n3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const makePublic = vi.fn();
vi.mock("./publish", async (orig) => ({ ...(await orig<typeof import("./publish")>()), makePublic: (...a: unknown[]) => makePublic(...a) }));
const { checkLogo, logoAddress, logoUrl, saveLogoAddress, sniffLogo, uploadLogo, LOGO_MAX } = await import("./logo");
const { PublishError } = await import("./publish");

const ROOT = "https://weld-done.pod.example/";
const SPACE_FILE = ROOT + "space.ttl";
const LOGO = ROOT + "logo";
const WEBID = ROOT + "profile/card#me";
const FILE = (logo?: string) => `@prefix schema: <https://schema.org/> .
@prefix mom: <https://mapsofmaking.org/ns/mom#> .
<#space> a mom:Space, schema:Place ;
  schema:name "Weld Done"${logo ? ` ;\n  schema:logo <${logo}>` : ""} .
`;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const blob = (bytes: Uint8Array, type = "image/png") => new Blob([bytes as BlobPart], { type });

/** A pod with the space file (N3 Patch applied as CSS does: ETag and deletes must match) and maybe a `logo`. */
function pod(text: string, logo: { bytes: Uint8Array; type: string } | null = null) {
  let store = new Store(new Parser({ baseIRI: SPACE_FILE }).parse(text));
  let version = 1;
  let logoVersion = 1;
  const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
  const turtle = () => new Writer({ format: "Turtle" }).quadsToString(store.getQuads(null, null, null, null));
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, method, headers });
    if (url === LOGO) {
      if (method === "HEAD") return logo ? new Response(null, { status: 200, headers: { ETag: `"l${logoVersion}"`, "Content-Type": logo.type, "Content-Length": String(logo.bytes.length) } }) : new Response(null, { status: 404 });
      if (method === "PUT") {
        if (headers["If-None-Match"] === "*" && logo) return new Response(null, { status: 412 });
        if (headers["If-Match"] && (!logo || headers["If-Match"] !== `"l${logoVersion}"`)) return new Response(null, { status: 412 });
        logo = { bytes: new Uint8Array(await (init!.body as Blob).arrayBuffer()), type: headers["Content-Type"] };
        logoVersion++;
        return new Response(null, { status: 201 });
      }
      if (method === "DELETE") {
        if (!logo || headers["If-Match"] !== `"l${logoVersion}"`) return new Response(null, { status: 412 });
        logo = null;
        return new Response(null, { status: 205 });
      }
    }
    if (method === "GET") return new Response(turtle(), { status: 200, headers: { ETag: `"v${version}"` } });
    if (headers["If-Match"] && headers["If-Match"] !== `"v${version}"`) return new Response("", { status: 412 });
    const quads: Quad[] = new Parser({ format: "text/n3", baseIRI: SPACE_FILE }).parse(init!.body as string);
    const formula = (p: string) => quads.find((q) => q.predicate.value === `http://www.w3.org/ns/solid/terms#${p}`)?.object;
    const inGraph = (g: Quad["object"] | undefined) => (g ? quads.filter((q) => q.graph.equals(g)) : []);
    const plain = (q: Quad) => store.getQuads(q.subject, q.predicate, q.object, null);
    if (inGraph(formula("deletes")).some((q) => plain(q).length === 0)) return new Response("", { status: 409 });
    const next = new Store(store.getQuads(null, null, null, null));
    inGraph(formula("deletes")).forEach((q) => next.removeQuads(plain(q)));
    inGraph(formula("inserts")).forEach((q) => next.addQuad(q.subject, q.predicate, q.object));
    store = next;
    version++;
    return new Response(null, { status: 205 });
  };
  const logos = () => new Parser({ baseIRI: SPACE_FILE }).parse(turtle()).filter((q) => q.predicate.value === "https://schema.org/logo").map((q) => q.object.value);
  return { fetchImpl, calls, logos, logo: () => logo };
}

beforeEach(() => {
  makePublic.mockReset();
  makePublic.mockResolvedValue({ status: "made-public" });
});

describe("the logo's checks, before anything is written (14.6 S6, #41)", () => {
  it("knows PNG, JPEG and WebP by their own bytes, whatever the browser says", () => {
    expect(sniffLogo(PNG)).toBe("image/png");
    expect(sniffLogo(JPEG)).toBe("image/jpeg");
    expect(sniffLogo(WEBP)).toBe("image/webp");
    expect(sniffLogo(SVG)).toBeNull();
    expect(sniffLogo(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]))).toBeNull(); // RIFF, but AVI
  });

  it("refuses an SVG (even called image/png), an empty file, and anything over 512 KB", async () => {
    await expect(checkLogo(blob(SVG, "image/png"))).rejects.toMatchObject({ code: "not-image" });
    await expect(checkLogo(blob(new Uint8Array()))).rejects.toMatchObject({ code: "not-image" });
    const big = new Uint8Array(LOGO_MAX + 1);
    big.set(PNG);
    await expect(checkLogo(blob(big))).rejects.toMatchObject({ code: "too-large" });
  });

  it("a refused file is never written: no request at all", async () => {
    const p = pod(FILE());
    await expect(uploadLogo(ROOT, WEBID, blob(SVG), null, p.fetchImpl)).rejects.toMatchObject({ code: "not-image" });
    expect(p.calls).toEqual([]);
  });
});

describe("uploading the logo (14.6 S6, #41)", () => {
  it("first time: created only if absent, with the sniffed type, opened, proved, then pointed at", async () => {
    const p = pod(FILE());
    const r = await uploadLogo(ROOT, WEBID, blob(PNG, "application/octet-stream"), null, p.fetchImpl);
    const put = p.calls.find((c) => c.method === "PUT")!;
    expect(put.url).toBe(LOGO);
    expect(put.headers).toMatchObject({ "Content-Type": "image/png", "If-None-Match": "*" });
    expect(p.logo()!.type).toBe("image/png");
    expect(makePublic).toHaveBeenCalledWith(LOGO, WEBID, expect.objectContaining({ accept: "image/png" }));
    // The proof is the type written, as a stranger reads it.
    const { isTheResource } = makePublic.mock.calls[0][2];
    expect(isTheResource("", "image/png")).toBe(true);
    expect(isTheResource("<html>", "text/html")).toBe(false);
    expect(p.logos()).toEqual([LOGO]);
    expect(r).toMatchObject({ status: "saved", url: LOGO, was: null, opened: "made-public" });
  });

  it("schema:logo is written only after the file is public: a failed proof leaves the space file alone", async () => {
    const p = pod(FILE("https://elsewhere.example/old.png"));
    makePublic.mockRejectedValue(new PublishError("not-public", "anonymous read 401"));
    await expect(uploadLogo(ROOT, WEBID, blob(PNG), "https://elsewhere.example/old.png", p.fetchImpl)).rejects.toMatchObject({ code: "not-public" });
    expect(p.logos()).toEqual(["https://elsewhere.example/old.png"]);
    expect(p.calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("a step after the create fails: the file it made is taken back (If-Match), so a retry starts clean", async () => {
    const p = pod(FILE());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    makePublic.mockRejectedValueOnce(new PublishError("not-public", "anonymous read blocked"));
    await expect(uploadLogo(ROOT, WEBID, blob(PNG), null, p.fetchImpl)).rejects.toMatchObject({ code: "not-public" });
    expect(p.calls.find((c) => c.method === "DELETE")!.headers).toMatchObject({ "If-Match": '"l2"' });
    expect(p.logo()).toBeNull();
    const r = await uploadLogo(ROOT, WEBID, blob(PNG), null, p.fetchImpl);
    expect(r.status).toBe("saved");
    expect(p.logos()).toEqual([LOGO]);
    warn.mockRestore();
  });

  it("never takes back a replaced logo, nor one the space may already point at (unconfirmed)", async () => {
    const replaced = pod(FILE(LOGO), { bytes: PNG, type: "image/png" });
    makePublic.mockRejectedValueOnce(new PublishError("not-public", "x"));
    await expect(uploadLogo(ROOT, WEBID, blob(WEBP), LOGO, replaced.fetchImpl)).rejects.toMatchObject({ code: "not-public" });
    expect(replaced.calls.some((c) => c.method === "DELETE")).toBe(false);

    const p = pod(FILE());
    const lost = async (url: string, init?: RequestInit) => {
      // The patch lands, then every read of the space file fails: "unconfirmed".
      if (url === SPACE_FILE && (init?.method ?? "GET") === "GET" && p.calls.some((c) => c.method === "PATCH")) return new Response("", { status: 500 });
      return p.fetchImpl(url, init);
    };
    await expect(uploadLogo(ROOT, WEBID, blob(PNG), null, lost)).rejects.toMatchObject({ code: "unconfirmed" });
    expect(p.calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(p.logo()).not.toBeNull();
  });

  it("replacing: the same address, If-Match on the version read, the new type; the file isn't patched again", async () => {
    const p = pod(FILE(LOGO), { bytes: PNG, type: "image/png" });
    makePublic.mockResolvedValue({ status: "already-public" });
    const r = await uploadLogo(ROOT, WEBID, blob(WEBP), LOGO, p.fetchImpl);
    expect(p.calls.find((c) => c.method === "PUT")!.headers).toMatchObject({ "Content-Type": "image/webp", "If-Match": '"l1"' });
    expect(p.logo()!.type).toBe("image/webp");
    expect(r.status).toBe("same");
    expect(p.calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(p.logos()).toEqual([LOGO]);
  });

  it("a file named logo the space doesn't point at is someone's: left alone", async () => {
    const p = pod(FILE("https://elsewhere.example/old.png"), { bytes: JPEG, type: "image/jpeg" });
    await expect(uploadLogo(ROOT, WEBID, blob(PNG), "https://elsewhere.example/old.png", p.fetchImpl)).rejects.toMatchObject({ code: "taken" });
    expect(p.calls.some((c) => c.method === "PUT")).toBe(false);
    expect(p.logo()!.type).toBe("image/jpeg");
  });

  it("one created meanwhile (412 on create) is taken, not overwritten", async () => {
    const p = pod(FILE());
    const racing = async (url: string, init?: RequestInit) =>
      init?.method === "PUT" && url === LOGO ? new Response(null, { status: 412 }) : p.fetchImpl(url, init);
    await expect(uploadLogo(ROOT, WEBID, blob(PNG), null, racing)).rejects.toMatchObject({ code: "taken" });
    expect(p.logos()).toEqual([]);
  });

  it("the gateway's limit (413) and an ended session (401) say so; a half-stored file is named", async () => {
    const p = pod(FILE());
    const says = (status: number, stored?: number) => async (url: string, init?: RequestInit) => {
      if (url === LOGO && init?.method === "PUT") return new Response(null, { status });
      if (url === LOGO && init?.method === "HEAD" && stored !== undefined && p.calls.some((c) => c.method === "PUT"))
        return new Response(null, { status: 200, headers: { "Content-Length": String(stored) } });
      return p.fetchImpl(url, init);
    };
    await expect(uploadLogo(ROOT, WEBID, blob(PNG), null, says(413))).rejects.toMatchObject({ code: "too-large" });
    await expect(uploadLogo(ROOT, WEBID, blob(PNG), null, says(401))).rejects.toMatchObject({ code: "expired" });
    const err = await uploadLogo(ROOT, WEBID, blob(PNG), null, async (u, i) => {
      if (u === LOGO && i?.method === "PUT") { p.calls.push({ url: u, method: "PUT", headers: {} }); return new Response(null, { status: 500 }); }
      if (u === LOGO && i?.method === "HEAD" && p.calls.some((c) => c.method === "PUT")) return new Response(null, { status: 200, headers: { "Content-Length": "4" } });
      return p.fetchImpl(u, i);
    }).catch((e) => e);
    expect(err.message).toContain("Only part of it was stored (4 of 12 bytes)");
  });

  it("the logo's address sits next to the space file, from a root with or without its slash", () => {
    expect(logoUrl(ROOT)).toBe(LOGO);
    expect(logoUrl(ROOT.slice(0, -1))).toBe(LOGO);
  });
});

describe("a typed address still works (14.6 S6)", () => {
  it("http(s) only, and nothing that could end the IRI it is written as", () => {
    expect(logoAddress(" https://weld.example/logo.svg ")).toBe("https://weld.example/logo.svg");
    expect(logoAddress("javascript:alert(1)")).toBeNull();
    expect(logoAddress("data:image/png;base64,AAAA")).toBeNull();
    expect(logoAddress("weld.example/logo.png")).toBeNull();
    expect(logoAddress('https://weld.example/a">x')).not.toContain('"');
  });

  it("changes only schema:logo; no file is written", async () => {
    const p = pod(FILE());
    const r = await saveLogoAddress(ROOT, "https://weld.example/logo.svg", p.fetchImpl);
    expect(p.logos()).toEqual(["https://weld.example/logo.svg"]);
    expect(p.calls.some((c) => c.url === LOGO)).toBe(false);
    expect(r.status).toBe("saved");
    await expect(saveLogoAddress(ROOT, "ftp://x", p.fetchImpl)).rejects.toMatchObject({ code: "not-image" });
  });
});
