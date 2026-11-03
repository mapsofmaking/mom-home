import { Parser, Store, Writer, type Quad } from "n3";
import { describe, expect, it } from "vitest";
import { hoursPatch, saveHours } from "./hours";
import { PublishError } from "./publish";

const URL_ = "https://weld-done.pod.example/space.ttl";
const SPACE = `${URL_}#space`;
const FILE = (hours?: string, extra = "") => `@prefix schema: <https://schema.org/> .
@prefix mom: <https://mapsofmaking.org/ns/mom#> .
<#space> a mom:Space, schema:Place ;
  schema:name "Weld Done"${hours === undefined ? "" : ` ;\n  schema:openingHours ${JSON.stringify(hours)}`}${extra} .
`;

/**
 * A pod that holds one Turtle file and applies N3 Patches the way CSS does: the ETag must match
 * (412), and every delete must be in the file (409), or nothing changes.
 */
function pod(text: string) {
  let store = new Store(new Parser({ baseIRI: URL_ }).parse(text));
  let version = 1;
  const calls: { method: string; body?: string; ifMatch?: string }[] = [];
  const turtle = () => new Writer({ format: "Turtle" }).quadsToString(store.getQuads(null, null, null, null));
  const fetchImpl = async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ method, body: init?.body as string | undefined, ifMatch: headers["If-Match"] });
    if (method === "GET") return new Response(turtle(), { status: 200, headers: { ETag: `"v${version}"` } });
    if (headers["If-Match"] && headers["If-Match"] !== `"v${version}"`) return new Response("", { status: 412 });
    const quads: Quad[] = new Parser({ format: "text/n3", baseIRI: URL_ }).parse(init!.body as string);
    const formula = (p: string) => quads.find((q) => q.predicate.value === `http://www.w3.org/ns/solid/terms#${p}`)?.object;
    const inGraph = (g: Quad["object"] | undefined) => (g ? quads.filter((q) => q.graph.equals(g)) : []);
    const deletes = inGraph(formula("deletes"));
    const inserts = inGraph(formula("inserts"));
    const plain = (q: Quad) => store.getQuads(q.subject, q.predicate, q.object, null);
    if (deletes.some((q) => plain(q).length === 0)) return new Response("", { status: 409 });
    const next = new Store(store.getQuads(null, null, null, null));
    deletes.forEach((q) => next.removeQuads(plain(q)));
    inserts.forEach((q) => next.addQuad(q.subject, q.predicate, q.object));
    store = next;
    version++;
    return new Response(null, { status: 205 });
  };
  return { fetchImpl, calls, edit: (t: string) => { store = new Store(new Parser({ baseIRI: URL_ }).parse(t)); version++; }, text: turtle };
}

const hoursIn = (text: string) =>
  new Parser({ baseIRI: URL_ }).parse(text).filter((q) => q.predicate.value === "https://schema.org/openingHours").map((q) => q.object.value);

describe("the hours, changed once in the space's file (14.6 S1, #36)", () => {
  it("adds hours to a file that had none, read back", async () => {
    const p = pod(FILE());
    const r = await saveHours(URL_, "  Tu-Sa 10:00-18:00 ", p.fetchImpl);
    expect(r).toEqual({ status: "saved", was: null, hours: "Tu-Sa 10:00-18:00" });
    expect(hoursIn(p.text())).toEqual(["Tu-Sa 10:00-18:00"]);
  });

  it("changes them in place: the old line goes, the new one comes", async () => {
    const p = pod(FILE("Tu-Sa 10:00-18:00"));
    const r = await saveHours(URL_, "Tu-Fr 12:00-20:00", p.fetchImpl);
    expect(r.was).toBe("Tu-Sa 10:00-18:00");
    expect(hoursIn(p.text())).toEqual(["Tu-Fr 12:00-20:00"]);
  });

  it("touches nothing else in the file: another writer's statements stay", async () => {
    const p = pod(FILE("Mo 9-12", ` ;\n  schema:telephone "+32 2 000 00 00"`));
    await saveHours(URL_, "Mo 9-17", p.fetchImpl);
    expect(p.text()).toContain("+32 2 000 00 00");
    expect(p.calls.filter((c) => c.method === "PUT")).toEqual([]);
  });

  it("sends the ETag of its own read: a file changed meanwhile is refused, nothing written", async () => {
    const p = pod(FILE("Mo 9-12"));
    const sneaky = async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") p.edit(FILE("Mo 9-13"));
      return p.fetchImpl(url, init);
    };
    const err = await saveHours(URL_, "Mo 9-17", sneaky).catch((e) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect((err as PublishError).code).toBe("conflict");
    expect(hoursIn(p.text())).toEqual(["Mo 9-13"]);
    expect(p.calls.find((c) => c.method === "PATCH")!.ifMatch).toBe('"v1"');
  });

  it("the same hours: nothing is written", async () => {
    const p = pod(FILE("Mo 9-12"));
    expect((await saveHours(URL_, "Mo 9-12", p.fetchImpl)).status).toBe("same");
    expect(p.calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("two hours lines (someone else's edit) become one", async () => {
    const p = pod(FILE("Mo 9-12", ` ;\n  schema:openingHours "Tu 9-12"`));
    await saveHours(URL_, "Mo-Tu 9-12", p.fetchImpl);
    expect(hoursIn(p.text())).toEqual(["Mo-Tu 9-12"]);
  });

  it("a language-tagged value is deleted as it is, tag included", () => {
    const [q] = new Parser({ baseIRI: URL_ }).parse(`<#space> <https://schema.org/openingHours> "lundi"@fr .`);
    expect(hoursPatch(SPACE, [q], "Mo 9-12")).toContain(`"lundi"@fr`);
  });

  it("quotes in the hours are escaped, never the end of the literal", () => {
    expect(hoursPatch(SPACE, [], 'Mo "late" 9-12')).toContain('"Mo \\"late\\" 9-12"');
  });

  it("says what failed: expired (401/403), gone (404), refused, unreachable", async () => {
    const answer = (status: number) => async () => new Response("", { status });
    for (const [status, code] of [[401, "expired"], [403, "expired"], [404, "gone"], [500, "refused"]] as const) {
      const err = await saveHours(URL_, "Mo 9-12", answer(status)).catch((e) => e);
      expect((err as PublishError).code, String(status)).toBe(code);
    }
    const down = await saveHours(URL_, "Mo 9-12", async () => { throw new TypeError("network"); }).catch((e) => e);
    expect((down as PublishError).code).toBe("unreachable");
  });

  it("refuses empty hours before asking the pod anything", async () => {
    const p = pod(FILE());
    const err = await saveHours(URL_, "   ", p.fetchImpl).catch((e) => e);
    expect((err as PublishError).code).toBe("incomplete");
    expect(p.calls).toEqual([]);
  });
});
