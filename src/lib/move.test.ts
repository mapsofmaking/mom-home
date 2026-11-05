import { Parser, type Term } from "n3";
import { pod, URL_ } from "./fakepod";
import { describe, expect, it } from "vitest";
import { decimal, moveSpace, type Place } from "./move";
import { PublishError } from "./publish";

const SPACE = `${URL_}#space`;
const S = "https://schema.org/";
const FILE = (extra = "", address = `[ a schema:PostalAddress ;
    schema:streetAddress "Rue Haute 12" ;
    schema:postalCode "1000" ;
    schema:addressLocality "Brussels" ;
    schema:addressCountry "BE" ]`, geo = `[ a schema:GeoCoordinates ;
    schema:latitude 50.8381 ; schema:longitude 4.3487 ]`) => `@prefix schema: <https://schema.org/> .
@prefix mom: <https://mapsofmaking.org/ns/mom#> .
<#space> a mom:Space, schema:Place ;
  schema:name "Weld Done" ;
  schema:openingHours "Mo 9-17" ;
  schema:address ${address} ;
  schema:geo ${geo}${extra} .
`;

const GRAY: Place = { street: "158 Rue Gray", postcode: "1050", city: "Ixelles", country: "be", lat: 50.8301234567, lon: 4.3801 };

/** What the file says about where the space is. */
function where(text: string) {
  const quads = new Parser({ baseIRI: URL_ }).parse(text);
  const objs = (s: Term, p: string) => quads.filter((q) => q.subject.equals(s) && q.predicate.value === S + p).map((q) => q.object);
  const space = quads.find((q) => q.subject.value === SPACE)!.subject;
  const [address] = objs(space, "address");
  const [geo] = objs(space, "geo");
  const v = (s: Term, p: string) => objs(s, p).map((o) => o.value);
  return {
    addresses: objs(space, "address").length, geos: objs(space, "geo").length,
    street: v(address, "streetAddress"), postcode: v(address, "postalCode"), city: v(address, "addressLocality"),
    country: v(address, "addressCountry"), lat: v(geo, "latitude"), lon: v(geo, "longitude"), region: v(address, "addressRegion"),
    orphanLats: quads.filter((q) => q.predicate.value === S + "latitude").length,
  };
}

describe("a space that moves (14.6 S5, #40)", () => {
  it("the address and the pin change in one write, on the same nodes", async () => {
    const p = pod(FILE());
    const r = await moveSpace(URL_, GRAY, p.fetchImpl);
    expect(r.status).toBe("saved");
    expect(r.was).toEqual({ street: "Rue Haute 12", postcode: "1000", city: "Brussels", country: "BE", lat: 50.8381, lon: 4.3487 });
    expect(r.now).toMatchObject({ street: "158 Rue Gray", country: "BE", lat: 50.8301235, lon: 4.3801 });
    const w = where(p.text());
    expect(w).toMatchObject({
      addresses: 1, geos: 1, street: ["158 Rue Gray"], postcode: ["1050"], city: ["Ixelles"], country: ["BE"],
      lat: ["50.8301235"], lon: ["4.3801"], orphanLats: 1,
    });
    expect(p.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    expect(p.calls.filter((c) => c.method === "PUT")).toEqual([]);
    expect(r.text).toContain("158 Rue Gray");
  });

  it("sends the ETag of its own read, and names the nodes by variables bound to what was read", async () => {
    const p = pod(FILE());
    await moveSpace(URL_, GRAY, p.fetchImpl);
    const patch = p.calls.find((c) => c.method === "PATCH")!;
    expect(patch.ifMatch).toBe('"v1"');
    expect(patch.body).toContain("solid:where");
    expect(patch.body).toMatch(/\?a <https:\/\/schema\.org\/streetAddress> "Rue Haute 12"/);
    expect(patch.body).not.toContain("_:b");
  });

  it("touches nothing else: another writer's statements, and their fields on the address node, stay", async () => {
    const p = pod(FILE(` ;\n  schema:telephone "+32 2 000 00 00"`, `[ schema:streetAddress "Rue Haute 12" ; schema:addressLocality "Brussels" ;
      schema:addressCountry "BE" ; schema:addressRegion "Brussels-Capital" ]`));
    await moveSpace(URL_, GRAY, p.fetchImpl);
    expect(p.text()).toContain("+32 2 000 00 00");
    expect(p.text()).toContain("Mo 9-17");
    expect(where(p.text()).region).toEqual(["Brussels-Capital"]);
  });

  it("no street found or typed: the old street goes, the town's pin is written", async () => {
    const p = pod(FILE());
    await moveSpace(URL_, { ...GRAY, street: "", postcode: "" }, p.fetchImpl);
    expect(where(p.text())).toMatchObject({ street: [], postcode: [], city: ["Ixelles"] });
  });

  it("the same place: nothing written, said so", async () => {
    const p = pod(FILE());
    const r = await moveSpace(URL_, { street: "Rue Haute 12", postcode: "1000", city: "Brussels", country: "BE", lat: 50.8381, lon: 4.3487 }, p.fetchImpl);
    expect(r.status).toBe("same");
    expect(p.calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("a file changed meanwhile is refused (412), nothing written", async () => {
    const p = pod(FILE());
    const sneaky = async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") p.edit(FILE(` ;\n  schema:email "a@b.example"`));
      return p.fetchImpl(url, init);
    };
    const err = await moveSpace(URL_, GRAY, sneaky).catch((e) => e);
    expect((err as PublishError).code).toBe("conflict");
    expect(where(p.text()).street).toEqual(["Rue Haute 12"]);
  });

  it("an address changed meanwhile no longer matches the where (409): nothing written", async () => {
    const p = pod(FILE());
    const late = async (url: string, init?: RequestInit) => {
      if (init?.method !== "PATCH") return p.fetchImpl(url, init);
      // Someone moved it first, and the pod's ETag check passes (the edit's version is the one sent).
      p.edit(FILE("", `[ schema:streetAddress "Kaai 3" ; schema:addressLocality "Ghent" ; schema:addressCountry "BE" ]`));
      const etag = (await p.fetchImpl(url)).headers.get("ETag")!;
      return p.fetchImpl(url, { ...init, headers: { ...(init.headers as Record<string, string>), "If-Match": etag } });
    };
    const err = await moveSpace(URL_, GRAY, late).catch((e) => e);
    expect((err as PublishError).code).toBe("conflict");
    expect(where(p.text())).toMatchObject({ street: ["Kaai 3"], lat: ["50.8381"] });
  });

  it("two addresses, or none, or coordinates as text: left alone, nothing written", async () => {
    for (const text of [
      FILE(` ;\n  schema:address [ schema:addressLocality "Ghent" ; schema:addressCountry "BE" ]`),
      FILE("", `"Rue Haute 12, Brussels"`),
      `@prefix schema: <https://schema.org/> .\n@prefix mom: <https://mapsofmaking.org/ns/mom#> .\n<#space> a mom:Space ; schema:name "W" .\n`,
    ]) {
      const p = pod(text);
      const err = await moveSpace(URL_, GRAY, p.fetchImpl).catch((e) => e);
      expect((err as PublishError).code).toBe("unreadable");
      expect(p.calls.filter((c) => c.method !== "GET")).toEqual([]);
    }
  });

  it("a place without a town, a country or coordinates is refused before anything is read", async () => {
    for (const bad of [{ ...GRAY, city: " " }, { ...GRAY, country: "Belgium" }, { ...GRAY, lat: 91 }, { ...GRAY, lon: NaN }]) {
      const p = pod(FILE());
      const err = await moveSpace(URL_, bad, p.fetchImpl).catch((e) => e);
      expect((err as PublishError).code).toBe("incomplete");
      expect(p.calls).toEqual([]);
    }
  });

  it("typed text can't break out of its literal", async () => {
    const p = pod(FILE());
    await moveSpace(URL_, { ...GRAY, street: 'Rue "Haute" } ; solid:deletes { <x> <y> <z> } .\n12' }, p.fetchImpl);
    expect(where(p.text()).street).toEqual(['Rue "Haute" } ; solid:deletes { <x> <y> <z> } .\n12']);
    expect(p.text()).toContain("Mo 9-17");
  });

  it("a write that went in but can't be read back is said as unconfirmed, not as nothing written", async () => {
    const p = pod(FILE());
    let gets = 0;
    const flaky = async (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET" && ++gets === 2) return new Response("", { status: 500 });
      return p.fetchImpl(url, init);
    };
    const err = await moveSpace(URL_, GRAY, flaky).catch((e) => e);
    expect((err as PublishError).code).toBe("unconfirmed");
  });

  it("coordinates are written as decimals Turtle reads back the same", () => {
    expect(decimal(50.8)).toBe("50.8");
    expect(decimal(4)).toBe("4.0");
    expect(decimal(-0.00000001)).toBe("-0.0");
    expect(decimal(1e-7)).toBe("0.0000001");
  });
});
