import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Parser, type Term } from "n3";
import { describe, expect, it } from "vitest";
import { parseTree } from "../tree/parse";
import { pod, URL_ } from "./fakepod";
import type { Place } from "./move";
import { PublishError } from "./publish";
import { check, checkPlace, readProfile, saveProfile } from "./profile";
import { readSpaceFile } from "./hours";

const DEF = parseTree(readFileSync(join(__dirname, "../../public/onboarding.ttl"), "utf8")).profile;
const S = "https://schema.org/";

const FILE = (extra = "") => `@prefix schema: <https://schema.org/> .
@prefix mom: <https://mapsofmaking.org/ns/mom#> .
<#space> a mom:Space, schema:Place ;
  schema:name "Weld Done" ;
  schema:openingHours "Mo 9-17" ;
  schema:email "hello@welddone.example" ;
  schema:url <https://welddone.example/> ;
  schema:contactPoint [ a schema:ContactPoint ; schema:contactType "Matrix" ; schema:url <https://matrix.to/#/%23welddone:matrix.org> ] ;
  schema:address [ a schema:PostalAddress ; schema:streetAddress "Rue Haute 12" ; schema:postalCode "1000" ; schema:addressLocality "Brussels" ; schema:addressCountry "BE" ] ;
  schema:geo [ a schema:GeoCoordinates ; schema:latitude 50.8381 ; schema:longitude 4.3487 ]${extra} .
`;

const fileOf = async (p: ReturnType<typeof pod>) => readProfile(await readSpaceFile(URL_, p.fetchImpl), DEF);
const objects = (text: string, p: string) => {
  const quads = new Parser({ baseIRI: URL_ }).parse(text);
  return quads.filter((q) => q.predicate.value === S + p).map((q) => ({ value: q.object.value, type: q.object.termType as Term["termType"] }));
};

describe("the profile, read from the file (14.6 S4, #39)", () => {
  it("each field's value, as the file holds it", async () => {
    const p = await fileOf(pod(FILE()));
    const v = (k: string) => p.values.get(k);
    expect(v("name")?.text).toBe("Weld Done");
    expect(v("hours")?.text).toBe("Mo 9-17");
    expect(v("website")).toMatchObject({ text: "https://welddone.example/", literal: false });
    expect(p.contacts?.handles.map((h) => [h.type, h.value])).toEqual([["email", "hello@welddone.example"], ["matrix", "#welddone:matrix.org"]]);
    expect(v("logo")?.text).toBe("");
    expect(p.place).toMatchObject({ street: "Rue Haute 12", city: "Brussels", country: "BE", lat: 50.8381 });
  });
  it("predicates no field covers are listed, never touched", async () => {
    const p = await fileOf(pod(FILE(` ;\n  schema:faxNumber "+32 2 000 00 00"`)));
    expect(p.others).toEqual([S + "faxNumber"]);
  });
  it("a file without exactly one address says so, and its other fields still read", async () => {
    const p = await fileOf(pod(FILE(` ;\n  schema:address [ schema:addressLocality "Ghent" ]`)));
    expect(p.place).toBeNull();
    expect(p.placeProblem).toMatch(/2 address/);
    expect(p.values.get("name")?.text).toBe("Weld Done");
  });
});

describe("checking a value: mend what loses nothing, flag what needs a guess", () => {
  it("text: spaces mend; empty is a problem only when required", () => {
    expect(check("text", "  Weld Done ")).toEqual({ type: "fix", why: "spaces", fixed: "Weld Done" });
    expect(check("text", "Weld Done")).toBeNull();
    expect(check("text", "", { required: true })).toEqual({ type: "problem", why: "empty" });
    expect(check("text", "")).toBeNull();
  });
  it("email: mailto: and spaces mend; no @ is a problem", () => {
    expect(check("email", "mailto:hello@welddone.example")).toEqual({ type: "fix", why: "prefix", fixed: "hello@welddone.example" });
    expect(check("email", " hello@welddone.example")).toEqual({ type: "fix", why: "spaces", fixed: "hello@welddone.example" });
    expect(check("email", "hello at welddone")).toEqual({ type: "problem", why: "email" });
  });
  it("web address: an IRI is fine; as text it mends to an IRI; a missing scheme is added, shown; nonsense is a problem", () => {
    expect(check("url", "https://welddone.example/")).toBeNull();
    expect(check("url", "https://welddone.example/", { literal: true })).toEqual({ type: "fix", why: "as-text", fixed: "https://welddone.example/" });
    expect(check("url", "welddone.example")).toEqual({ type: "fix", why: "scheme", fixed: "https://welddone.example" });
    expect(check("url", "not a web address")).toEqual({ type: "problem", why: "address" });
    expect(check("image", "javascript:alert(1)")).toEqual({ type: "problem", why: "address" });
  });
  it("the address: lower-case country mends; no town, a bad country, a pin off the globe are problems", () => {
    const ok: Place = { street: "x", postcode: "", city: "Brussels", country: "BE", lat: 50, lon: 4 };
    expect(checkPlace(ok)).toBeNull();
    expect(checkPlace({ ...ok, country: "be" })).toEqual({ type: "fix", why: "case", fixed: "BE" });
    expect(checkPlace({ ...ok, country: "Belgium" })).toEqual({ type: "problem", why: "country" });
    expect(checkPlace({ ...ok, city: " " })).toEqual({ type: "problem", why: "city" });
    expect(checkPlace({ ...ok, lat: 91 })).toEqual({ type: "problem", why: "pin" });
  });
});

describe("saving the profile: one conditional patch (14.6 S4)", () => {
  it("several fields in one write, the rest of the file untouched", async () => {
    const p = pod(FILE(` ;\n  schema:faxNumber "+32 2 000 00 00"`));
    const r = await saveProfile(URL_, DEF, { values: { name: "Weld Done 2", hours: "Tu-Sa 10-18", website: "https://welddone.example/new" } }, p.fetchImpl);
    expect(r.status).toBe("saved");
    expect(r.changes.map((c) => c.key)).toEqual(["name", "website", "hours"]); // the tree's order
    expect(p.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    expect(p.calls.find((c) => c.method === "PATCH")!.ifMatch).toBe('"v1"');
    const t = p.text();
    expect(objects(t, "name")).toEqual([{ value: "Weld Done 2", type: "Literal" }]);
    expect(objects(t, "openingHours")[0].value).toBe("Tu-Sa 10-18");
    expect(objects(t, "url").find((o) => o.value === "https://welddone.example/new")?.type).toBe("NamedNode");
    expect(t).toContain("+32 2 000 00 00");
    expect(t).toContain("hello@welddone.example");
  });

  it("the address and a field together: the pin moves with it, in the same patch", async () => {
    const p = pod(FILE());
    const place: Place = { street: "158 Rue Gray", postcode: "1050", city: "Ixelles", country: "BE", lat: 50.83, lon: 4.38 };
    const r = await saveProfile(URL_, DEF, { values: { hours: "Mo 8-9" }, place }, p.fetchImpl);
    expect(r.changes.map((c) => c.key)).toEqual(["address", "hours"]);
    expect(p.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    expect(objects(p.text(), "streetAddress")[0].value).toBe("158 Rue Gray");
    expect(objects(p.text(), "latitude")[0].value).toBe("50.83");
    expect(objects(p.text(), "openingHours")[0].value).toBe("Mo 8-9");
  });

  it("an optional field emptied is removed; a required one can't be", async () => {
    const p = pod(FILE());
    await saveProfile(URL_, DEF, { values: { website: "" } }, p.fetchImpl);
    expect(objects(p.text(), "url").map((o) => o.value)).not.toContain("https://welddone.example/");
    expect(p.text()).toContain("Weld Done");
    const err = await saveProfile(URL_, DEF, { values: { name: " " } }, p.fetchImpl).catch((e) => e);
    expect((err as PublishError).code).toBe("incomplete");
  });


  it("a web address held as text is mended by saving it", async () => {
    const p = pod(FILE().replace("<https://welddone.example/>", '"https://welddone.example/"'));
    expect(objects(p.text(), "url")[0].type).toBe("Literal");
    const r = await saveProfile(URL_, DEF, { values: { website: "https://welddone.example/" } }, p.fetchImpl);
    expect(r.status).toBe("saved");
    expect(objects(p.text(), "url")[0].type).toBe("NamedNode");
  });

  it("nothing differs: nothing written", async () => {
    const p = pod(FILE());
    const r = await saveProfile(URL_, DEF, { values: { name: "Weld Done", hours: "Mo 9-17" }, handles: [{ type: "email", value: "hello@welddone.example" }, { type: "matrix", value: "#welddone:matrix.org" }] }, p.fetchImpl);
    expect(r.status).toBe("same");
    expect(p.calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("a file changed meanwhile is refused (412): nothing written", async () => {
    const p = pod(FILE());
    const sneaky = async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") p.edit(FILE(` ;\n  schema:telephone "1"`));
      return p.fetchImpl(url, init);
    };
    const err = await saveProfile(URL_, DEF, { values: { name: "X" } }, sneaky).catch((e) => e);
    expect((err as PublishError).code).toBe("conflict");
    expect(objects(p.text(), "name")[0].value).toBe("Weld Done");
  });

  it("typed text can't break out of its literal", async () => {
    const p = pod(FILE());
    const nasty = 'X" } ; solid:deletes { <x> <y> <z> } .\n';
    await saveProfile(URL_, DEF, { values: { description: nasty } }, p.fetchImpl);
    expect(objects(p.text(), "description")[0].value).toBe(nasty.trim());
    expect(objects(p.text(), "name")[0].value).toBe("Weld Done");
  });

  it("a web address this file won't carry is refused, nothing written", async () => {
    const p = pod(FILE());
    const err = await saveProfile(URL_, DEF, { values: { website: "ftp://a.example/b" } }, p.fetchImpl).catch((e) => e);
    expect((err as PublishError).code).toBe("incomplete");
    expect(p.calls.filter((c) => c.method === "PATCH")).toEqual([]);
  });

  it("a write that went in but can't be read back is unconfirmed, not 'nothing written'", async () => {
    const p = pod(FILE());
    let gets = 0;
    const flaky = async (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET" && ++gets === 2) return new Response("", { status: 500 });
      return p.fetchImpl(url, init);
    };
    const err = await saveProfile(URL_, DEF, { values: { name: "Y" } }, flaky).catch((e) => e);
    expect((err as PublishError).code).toBe("unconfirmed");
  });
});
