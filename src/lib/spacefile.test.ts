import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { iri, literal, matrixLink, sameStatements, spaceFile, SpaceFileError, statements } from "./spacefile";

/** Pinned to maps_of_making 12bb32a (test/fixtures/README.md): the file as the map reads it. */
const fixture = readFileSync(join(__dirname, "../../test/fixtures/atelier-du-canal.ttl"), "utf8");
/** The draft tile A would hold for that space. */
const draft = {
  name: "Atelier du Canal",
  description: "Open workshop for repairs and prototypes.",
  street: "Rue du Canal 12",
  postcode: "1070",
  city: "Anderlecht",
  country: "BE",
  lat: "50.8391",
  lon: "4.3297",
  email: "contact@atelierducanal.example",
  matrix: "#atelier:matrix.org",
};

describe("the space file is the file the map reads (14.4 AC2, the parity test)", () => {
  it("says exactly the statements of the map's fixture for the same values", () => {
    const { turtle, dropped } = spaceFile(draft);
    expect(dropped).toEqual([]);
    expect(statements(turtle)).toEqual(statements(fixture));
    expect(sameStatements(turtle, fixture)).toBe(true);
  });

  it("is deterministic: the same draft gives the same text", () => {
    expect(spaceFile(draft).turtle).toBe(spaceFile({ ...draft }).turtle);
  });

  it("types the space as the map expects, at <#space>", () => {
    const lines = statements(spaceFile(draft).turtle);
    expect(lines).toContain("<https://pod.example/space.ttl#space> http://www.w3.org/1999/02/22-rdf-syntax-ns#type <https://mapsofmaking.org/ns/mom#Space>");
    expect(lines).toContain("<https://pod.example/space.ttl#space> http://www.w3.org/1999/02/22-rdf-syntax-ns#type <https://schema.org/Place>");
  });

  it("leaves out what was not given, and writes the optional web addresses when they are good", () => {
    const small = statements(spaceFile({ name: "Weld Done", city: "Marolles", country: "be", lat: "50.8371", lon: "4.3458" }).turtle).join("\n");
    expect(small).not.toContain("description");
    expect(small).not.toContain("email");
    expect(small).not.toContain("streetAddress");
    expect(small).toContain('"BE"');
    const rich = statements(spaceFile({ ...draft, website: "https://welddone.example/", logo: "https://welddone.example/logo.png" }).turtle).join("\n");
    expect(rich).toContain("https://schema.org/url <https://welddone.example/>");
    expect(rich).toContain("https://schema.org/logo <https://welddone.example/logo.png>");
  });
});

describe("what is required, and what is made safe", () => {
  it("refuses a draft with no name, no town, no country or no pin, naming what is missing", () => {
    expect(() => spaceFile({})).toThrow(SpaceFileError);
    try {
      spaceFile({ name: "x", city: "y", country: "Belgium", lat: "50.8", lon: "" });
    } catch (e) {
      expect((e as SpaceFileError).missing).toEqual(["country", "pin"]);
    }
    expect(() => spaceFile({ ...draft, lat: "50,8391" })).toThrow(SpaceFileError);
    expect(() => spaceFile({ ...draft, name: "   " })).toThrow(SpaceFileError);
  });

  it("escapes every string, so a typed value can never end or bend the statement", () => {
    const nasty = 'He said "hi"\\ \n then <script>\r\t\u0001 ; schema:name "x" .';
    const { turtle } = spaceFile({ ...draft, name: nasty, description: nasty, street: nasty });
    const names = statements(turtle).filter((l) => l.includes("schema.org/name"));
    expect(names).toHaveLength(1);
    expect(names[0]).toContain(JSON.stringify(nasty));
    expect(statements(turtle).filter((l) => l.includes("schema.org/name"))).toHaveLength(1);
  });

  it("only carries http(s) addresses without anything that could end the IRI, and says what it left out", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://x.example/", "not a url", "https://a b.example/", "https://a.example:99999/", "https://a.example/x|y"]) {
      const { turtle, dropped } = spaceFile({ ...draft, matrix: "", website: bad, logo: bad });
      expect(dropped, bad).toEqual(["website", "logo"]);
      expect(turtle).not.toContain("schema:url");
      expect(turtle).not.toContain("schema:logo");
    }
    // Characters that could end an IRI in a path are encoded by the URL parser, never written raw.
    for (const awkward of ["https://a.example/<b>", 'https://a.example/"q"', "https://a.example/a b"]) {
      const written = iri(awkward)!;
      expect(written, awkward).toMatch(/^<https:\/\/a\.example\/[^<>"{}|\s]*>$/);
      const { turtle, dropped } = spaceFile({ ...draft, matrix: "", website: awkward });
      expect(dropped).toEqual([]);
      expect(turtle).toContain(written);
    }
    expect(iri("https://example.org/a?b=c#d")).toBe("<https://example.org/a?b=c#d>");
    expect(iri("")).toBeNull();
  });

  it("writes Matrix as the matrix.to link, leaves a matrix.to link alone, and drops what isn't one", () => {
    expect(matrixLink("#atelier:matrix.org")).toBe("<https://matrix.to/#/%23atelier:matrix.org>");
    expect(matrixLink("https://matrix.to/#/%23atelier:matrix.org")).toBe("<https://matrix.to/#/%23atelier:matrix.org>");
    expect(matrixLink("+community:matrix.org")).toBe("<https://matrix.to/#/%2Bcommunity:matrix.org>");
    expect(matrixLink("atelier")).toBeNull();
    expect(spaceFile({ ...draft, matrix: "atelier" }).dropped).toEqual(["matrix"]);
  });

  it("literal() leaves no raw control character", () => {
    expect(literal("a\u0000b\u001fc\u007fd")).toBe('"a\\u0000b\\u001fc\\u007fd"');
  });
});

describe("sameStatements", () => {
  it("ignores prefixes, order and blank-node labels, and sees a changed value", () => {
    expect(sameStatements(fixture, fixture.replace("schema:", "s:").replace("@prefix s: <https://schema.org/> .", "@prefix schema: <https://schema.org/> . @prefix s: <https://schema.org/> ."))).toBe(true);
    expect(sameStatements(fixture, fixture.replace("Atelier du Canal", "Another"))).toBe(false);
    expect(sameStatements(fixture, "not turtle at all {{")).toBe(false);
  });
});
