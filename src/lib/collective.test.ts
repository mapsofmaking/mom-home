/**
 * The network as a collective (#69): done read from the pod, and a setup that writes only what is missing.
 * The pod here is a small in-memory one that answers like CSS: Link rel="acl", ETags, If-None-Match / If-Match
 * (412), N3 Patch inserts, and a stranger's read that only passes a file whose rules say foaf:Agent.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Parser, Store, Writer } from "n3";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth", () => ({ authFetch: vi.fn() }));
const { authFetch } = await import("./auth");
const { configTurtle, inviteLink, parseCollectiveConfig, readCollective, rosterTurtle, setUpCollective } = await import("./collective");

const ROOT = "https://zz-net.pod.example/";
const OWNER = "https://zz-net.pod.example/profile/card#me";
const SPACE_FILE = ROOT + "space.ttl";
const MAAKBIB = readFileSync(join(__dirname, "fixtures/maakbib-config.ttl"), "utf8");

const SPACE = `@prefix schema: <https://schema.org/> .
@prefix mom: <https://mapsofmaking.org/ns/mom#> .
<#space> a mom:Network, schema:Organization ;
  schema:name "ZZ Net" ;
  schema:description "A network of test workshops." .
`;
const ROOT_ACL = `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
@prefix foaf: <http://xmlns.com/foaf/0.1/>.
<#owner> a acl:Authorization; acl:agent <${OWNER}>; acl:accessTo <./>; acl:default <./>; acl:mode acl:Read, acl:Write, acl:Control.
<#public> a acl:Authorization; acl:agentClass foaf:Agent; acl:accessTo <./>; acl:mode acl:Read.
`;

type Call = { method: string; url: string; headers: Record<string, string>; body?: string };

/** A pod of a few resources. `status` forces an answer for a URL (a 401 on the roster, say). */
function fakePod(files: Record<string, string>, status: Record<string, number> = {}) {
  const docs = new Map<string, { body: string; v: number }>(Object.entries({ [ROOT]: "", [ROOT + ".acl"]: ROOT_ACL, ...files }).map(([u, b]) => [u, { body: b, v: 1 }]));
  const calls: Call[] = [];
  const aclOf = (url: string) => url + ".acl";
  const answer = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ method, url, headers, body: init.body as string | undefined });
    if (status[url]) return new Response(null, { status: status[url] });
    const doc = docs.get(url);
    const link: Record<string, string> = url.endsWith(".acl") ? {} : { Link: `<${aclOf(url)}>; rel="acl"` };
    if (method === "GET" || method === "HEAD") {
      if (!doc) return new Response(null, { status: 404, headers: link });
      return new Response(method === "HEAD" ? null : doc.body, { status: 200, headers: { ...link, ETag: `"v${doc.v}"`, "Content-Type": "text/turtle" } });
    }
    if (headers["If-None-Match"] === "*" && doc) return new Response(null, { status: 412 });
    if (headers["If-Match"] && (!doc || headers["If-Match"] !== `"v${doc.v}"`)) return new Response(null, { status: 412 });
    if (method === "PUT") {
      docs.set(url, { body: String(init.body ?? ""), v: (doc?.v ?? 0) + 1 });
      return new Response(null, { status: 201 });
    }
    if (method === "PATCH" && doc) {
      const patch = new Parser({ format: "text/n3", baseIRI: url }).parse(String(init.body));
      const inserts = patch.find((q) => q.predicate.value === "http://www.w3.org/ns/solid/terms#inserts")!.object;
      const deletes = patch.find((q) => q.predicate.value === "http://www.w3.org/ns/solid/terms#deletes");
      if (deletes) return new Response("this pod only takes inserts here", { status: 422 });
      const store = new Store(new Parser({ baseIRI: url }).parse(doc.body));
      for (const q of patch.filter((p) => p.graph.equals(inserts))) store.addQuad(q.subject, q.predicate, q.object);
      docs.set(url, { body: new Writer({ format: "Turtle" }).quadsToString(store.getQuads(null, null, null, null)), v: doc.v + 1 });
      return new Response(null, { status: 205 });
    }
    return new Response(null, { status: 405 });
  };
  /** A stranger: no session, so a file reads only when its own rules say anyone may. */
  const anonFetch = async (url: string): Promise<Response> => {
    const doc = docs.get(url);
    const acl = docs.get(aclOf(url));
    if (!doc || !acl || !/acl:agentClass foaf:Agent;[\s\S]*?acl:mode acl:Read/.test(acl.body)) return new Response(null, { status: 401 });
    return new Response(doc.body, { status: 200 });
  };
  vi.mocked(authFetch).mockImplementation((url, init) => answer(String(url), init));
  const writes = () => calls.filter((c) => !["GET", "HEAD"].includes(c.method));
  return { docs, calls, writes, anonFetch, fetch: (u: string, i?: RequestInit) => answer(u, i) };
}

const input = { podRoot: ROOT, webId: OWNER, name: "ZZ Net", slogan: "Join the ZZ Net network", description: "A network of test workshops.", spaceFile: SPACE_FILE };

beforeEach(() => vi.mocked(authFetch).mockReset());

describe("done is read from the pod (#69)", () => {
  it("Maakbib's hand-made config.ttl is done: its roster is members.ttl, followed, and nothing is written", async () => {
    const pod = fakePod({ [ROOT + "config.ttl"]: MAAKBIB, [ROOT + "members.ttl"]: "", [ROOT + "inbox/"]: "" });
    const read = await readCollective(ROOT, pod.fetch);
    expect(read).toMatchObject({ state: "done", collective: { name: "MaakBib", roster: ROOT + "members.ttl", inbox: ROOT + "inbox/" } });
    expect(pod.calls.map((c) => c.url)).not.toContain(ROOT + "membres.ttl");
    expect(pod.writes()).toEqual([]);
    // And the setup, pressed on a done collective, writes nothing either.
    await setUpCollective({ ...input, name: "MaakBib" }, { fetch: pod.fetch, anonFetch: pod.anonFetch });
    expect(pod.writes()).toEqual([]);
  });

  it("reads the schema words under http:// (Maakbib) and https:// (what home writes)", () => {
    expect(parseCollectiveConfig(MAAKBIB, ROOT + "config.ttl").slogan).toBe("Sluit aan bij het MaakBib-netwerk");
    const ours = configTurtle({ slug: "zz-net", name: "ZZ Net", slogan: "Join us", description: "Two lines.", roster: ROOT + "membres.ttl", inbox: ROOT + "inbox/", space: SPACE_FILE + "#space", root: ROOT });
    expect(ours).toContain("@prefix schema: <https://schema.org/> .");
    expect(parseCollectiveConfig(ours, ROOT + "config.ttl")).toMatchObject({ slogan: "Join us", description: "Two lines." });
  });

  it("a 401 or 403 on the roster or the inbox is the session, never \"missing\"", async () => {
    for (const code of [401, 403]) {
      for (const url of [ROOT + "members.ttl", ROOT + "inbox/", ROOT + "config.ttl"]) {
        const pod = fakePod({ [ROOT + "config.ttl"]: MAAKBIB, [ROOT + "members.ttl"]: "", [ROOT + "inbox/"]: "" }, { [url]: code });
        await expect(readCollective(ROOT, pod.fetch)).rejects.toMatchObject({ code: "expired", status: code });
        await expect(setUpCollective(input, { fetch: pod.fetch, anonFetch: pod.anonFetch })).rejects.toMatchObject({ code: "expired" });
        expect(pod.writes()).toEqual([]);
      }
    }
  });

  it("no config.ttl (404) is not set up; a roster that answers 404 is missing", async () => {
    expect(await readCollective(ROOT, fakePod({}).fetch)).toMatchObject({ state: "none", configUrl: ROOT + "config.ttl" });
    const half = fakePod({ [ROOT + "config.ttl"]: MAAKBIB, [ROOT + "inbox/"]: "" });
    expect(await readCollective(ROOT, half.fetch)).toMatchObject({ state: "incomplete", missing: ["roster"] });
  });

  it("a config.ttl that doesn't parse stops everything, says why, and is never rewritten", async () => {
    const broken = MAAKBIB.replace(/@prefix schema:.*\n/, "");
    const pod = fakePod({ [ROOT + "config.ttl"]: broken, [SPACE_FILE]: SPACE });
    await expect(readCollective(ROOT, pod.fetch)).rejects.toMatchObject({ code: "unreadable", message: expect.stringContaining("@prefix schema: <http://schema.org/>") });
    await expect(setUpCollective(input, { fetch: pod.fetch, anonFetch: pod.anonFetch })).rejects.toMatchObject({ code: "unreadable" });
    expect(pod.writes()).toEqual([]);
    expect(pod.docs.get(ROOT + "config.ttl")!.body).toBe(broken);
  });

  it("refuses a config whose roster or inbox is on another server: nothing is asked there", async () => {
    const elsewhere = MAAKBIB.replace("<members.ttl>", "<https://elsewhere.example/members.ttl>");
    const pod = fakePod({ [ROOT + "config.ttl"]: elsewhere });
    await expect(readCollective(ROOT, pod.fetch)).rejects.toMatchObject({ code: "unreadable", message: expect.stringContaining("outside this pod") });
    expect(pod.calls.some((c) => c.url.startsWith("https://elsewhere.example/"))).toBe(false);
  });
});

describe("the setup (#69): only what is missing, in an order that never points at nothing", () => {
  it("makes the inbox, the roster, config.ttl and the link back, each with its rules", async () => {
    const pod = fakePod({ [SPACE_FILE]: SPACE });
    const done = await setUpCollective(input, { fetch: pod.fetch, anonFetch: pod.anonFetch });
    expect(done).toMatchObject({ state: "done", link: "https://backoffice.mapsofmaking.org/?collective=https://zz-net.pod.example/config.ttl" });

    const order = pod.writes().map((c) => `${c.method} ${c.url.slice(ROOT.length)}`);
    expect(order).toEqual(["PUT inbox/", "PUT inbox/.acl", "PUT membres.ttl", "PUT membres.ttl.acl", "PUT config.ttl", "PUT config.ttl.acl", "PATCH space.ttl"]);
    // Every new file and every new rule: only if nothing is there.
    for (const c of pod.writes().filter((w) => w.method === "PUT")) expect(c.headers["If-None-Match"]).toBe("*");

    const inboxAcl = pod.docs.get(ROOT + "inbox/.acl")!.body;
    expect(inboxAcl).toMatch(/acl:agentClass acl:AuthenticatedAgent;\s+acl:accessTo <\.\/>;\s+acl:default <\.\/>;\s+acl:mode acl:Append\./);
    expect(inboxAcl).toContain(`acl:agent <${OWNER}>`);
    expect(inboxAcl).not.toContain("foaf:Agent;");

    const rosterAcl = pod.docs.get(ROOT + "membres.ttl.acl")!.body;
    expect(rosterAcl).toContain("acl:accessTo <./membres.ttl>");
    expect(rosterAcl).not.toContain("agentClass");
    expect(rosterAcl.match(/a acl:Authorization/g)).toHaveLength(1);
    expect(new Parser().parse(pod.docs.get(ROOT + "membres.ttl")!.body)).toEqual([]);

    const config = parseCollectiveConfig(pod.docs.get(ROOT + "config.ttl")!.body, ROOT + "config.ttl");
    expect(config).toMatchObject({ group: ROOT + "config.ttl#zz-net", name: "ZZ Net", slogan: input.slogan, description: input.description, roster: ROOT + "membres.ttl", inbox: ROOT + "inbox/", sharing: false });
    expect(pod.docs.get(ROOT + "config.ttl")!.body).toContain("rdfs:seeAlso <space.ttl#space>");
    expect(pod.docs.get(ROOT + "config.ttl")!.body).not.toContain("sameAs");
    expect(pod.docs.get(ROOT + "config.ttl.acl")!.body).toContain("acl:agentClass foaf:Agent");

    const patch = pod.writes().find((c) => c.method === "PATCH")!;
    expect(patch.headers["If-Match"]).toBe('"v1"');
    expect(patch.body).not.toContain("deletes");
    expect(patch.body).toContain(`<${SPACE_FILE}#space> <http://www.w3.org/2000/01/rdf-schema#seeAlso> <${ROOT}config.ttl#zz-net>`);
    expect(pod.docs.get(SPACE_FILE)!.body).toContain("schema.org/description"); // the rest of the file stays

    // Pressed again: nothing more.
    const n = pod.writes().length;
    await setUpCollective(input, { fetch: pod.fetch, anonFetch: pod.anonFetch });
    expect(pod.writes()).toHaveLength(n);
  });

  it("carries on after a run that stopped: what is there is kept, never written over", async () => {
    // An inbox the backoffice made (its newcomer steps use the same inbox/): anyone signed in may already append.
    const inboxAcl = ROOT_ACL.replace(/<#public>[^\n]*\n/, "") + "<#a> a acl:Authorization; acl:agentClass acl:AuthenticatedAgent; acl:accessTo <./>; acl:default <./>; acl:mode acl:Append.\n";
    const pod = fakePod({ [SPACE_FILE]: SPACE, [ROOT + "inbox/"]: "", [ROOT + "inbox/.acl"]: inboxAcl, [ROOT + "membres.ttl"]: rosterTurtle("x") });
    await setUpCollective(input, { fetch: pod.fetch, anonFetch: pod.anonFetch });
    const writes = pod.writes().map((c) => `${c.method} ${c.url.slice(ROOT.length)} ${c.headers["If-None-Match"] ?? c.headers["If-Match"] ?? ""}`);
    // inbox/ and membres.ttl answered 412 and were left alone; the inbox's rules already let anyone signed in append.
    // The roster a run that never finished made (no config.ttl yet) gets its "only me" rules now.
    expect(writes).toEqual(["PUT inbox/ *", "PUT membres.ttl *", "PUT membres.ttl.acl *", "PUT config.ttl *", "PUT config.ttl.acl *", 'PATCH space.ttl "v1"']);
    expect(pod.docs.get(ROOT + "membres.ttl")!.body).toBe(rosterTurtle("x"));
  });

  it("a config.ttl there with its roster missing: makes the roster IT names, never writes config.ttl", async () => {
    // Maakbib's config.ttl is public already: nothing is written to its rules.
    const publicConfig = ROOT_ACL.replace(/<\.\/>/g, "<./config.ttl>").replace(/acl:default[^;]*;/g, "");
    const pod = fakePod({ [SPACE_FILE]: SPACE, [ROOT + "config.ttl"]: MAAKBIB, [ROOT + "config.ttl.acl"]: publicConfig, [ROOT + "inbox/"]: "" });
    await setUpCollective({ ...input, name: "MaakBib" }, { fetch: pod.fetch, anonFetch: pod.anonFetch });
    const writes = pod.writes().map((c) => `${c.method} ${c.url.slice(ROOT.length)}`);
    expect(writes).toEqual(["PUT members.ttl", "PUT members.ttl.acl", "PATCH space.ttl"]);
    expect(pod.docs.get(ROOT + "config.ttl")!.body).toBe(MAAKBIB);
    expect(pod.docs.get(ROOT + "config.ttl.acl")!.body).toBe(publicConfig);
    expect(pod.docs.has(ROOT + "membres.ttl")).toBe(false);
    expect(pod.docs.get(ROOT + "members.ttl.acl")!.body).toContain("acl:accessTo <./members.ttl>");
  });

  it("a config.ttl made meanwhile (412) is never overwritten: it is the one linked to", async () => {
    const pod = fakePod({ [SPACE_FILE]: SPACE });
    const real = pod.fetch;
    let raced = false;
    const racing = async (url: string, init?: RequestInit) => {
      if (url === ROOT + "config.ttl" && init?.method === "PUT" && !raced) {
        raced = true;
        await real(url, { method: "PUT", body: configTurtle({ slug: "other", name: "Other", slogan: "", description: "", roster: ROOT + "membres.ttl", inbox: ROOT + "inbox/", space: SPACE_FILE + "#space", root: ROOT }) });
      }
      return real(url, init);
    };
    await setUpCollective(input, { fetch: racing, anonFetch: pod.anonFetch });
    expect(pod.docs.get(ROOT + "config.ttl")!.body).toContain("<#other>");
    expect(pod.docs.get(SPACE_FILE)!.body).toContain("config.ttl#other");
  });

  it("leaves space.ttl alone when it already links to the collective", async () => {
    const linked = SPACE.replace('schema:description "A network of test workshops." .', `schema:description "A network of test workshops." ;\n  <http://www.w3.org/2000/01/rdf-schema#seeAlso> <${ROOT}config.ttl#zz-net> .`);
    expect(linked).toContain("seeAlso");
    const pod = fakePod({ [SPACE_FILE]: linked });
    await setUpCollective(input, { fetch: pod.fetch, anonFetch: pod.anonFetch });
    expect(pod.writes().some((c) => c.method === "PATCH")).toBe(false);
  });

  it("refuses a network with no name before anything is written", async () => {
    const pod = fakePod({ [SPACE_FILE]: SPACE });
    await expect(setUpCollective({ ...input, name: "  " }, { fetch: pod.fetch, anonFetch: pod.anonFetch })).rejects.toMatchObject({ code: "incomplete" });
    expect(pod.writes()).toEqual([]);
  });
});

describe("the files' words", () => {
  it("escapes what the coordinator types, and leaves out what is empty", () => {
    const t = configTurtle({ slug: "zz-net", name: 'ZZ "Net"', slogan: "", description: "Line one\nline two", roster: ROOT + "membres.ttl", inbox: ROOT + "inbox/", space: SPACE_FILE + "#space", root: ROOT });
    const c = parseCollectiveConfig(t, ROOT + "config.ttl");
    expect(c).toMatchObject({ name: 'ZZ "Net"', description: "Line one\nline two" });
    expect(c.slogan).toBeUndefined();
    expect(t).not.toContain("schema:slogan");
  });

  it("links to the backoffice with the config's address, encoded as the backoffice's appLink does", () => {
    expect(inviteLink("https://zz-net.pod.example/config.ttl")).toBe("https://backoffice.mapsofmaking.org/?collective=https://zz-net.pod.example/config.ttl");
    expect(inviteLink("https://pod.example/a b/config.ttl?x=1&y#z")).toBe("https://backoffice.mapsofmaking.org/?collective=https://pod.example/a%20b/config.ttl%3Fx%3D1%26y%23z");
    expect(new URL(inviteLink("https://pod.example/a b/config.ttl")).searchParams.get("collective")).toBe("https://pod.example/a b/config.ttl");
  });

  it("writes the roster as the backoffice's template: comments and a prefix, no members", () => {
    expect(new Parser().parse(rosterTurtle(ROOT + "config.ttl#zz-net"))).toEqual([]);
    expect(rosterTurtle("a\nb")).not.toMatch(/^b>/m);
  });
});
