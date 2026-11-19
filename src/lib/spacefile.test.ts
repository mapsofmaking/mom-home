import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { draftFromStore, draftFromTurtle, iri, literal, matrixLink, sameStatements, spaceFile, SpaceFileError, statements } from "./spacefile";

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

describe("draftFromTurtle: the file in the pod back to tile A's draft (#11)", () => {
  const base = "https://atelier.pod.example/space.ttl";

  it("reads back what spaceFile writes, field for field", () => {
    expect(draftFromTurtle(spaceFile(draft).turtle, base)).toEqual(draft);
  });

  it("reads the map's own fixture the same way", () => {
    expect(draftFromTurtle(fixture, base)).toEqual(draft);
  });

  it("keeps web addresses and a non-matrix.to chat link as they are", () => {
    const d = { ...draft, matrix: "https://chat.example/room", website: "https://atelier.example/", logo: "https://atelier.example/logo.png" };
    expect(draftFromTurtle(spaceFile(d).turtle, base)).toEqual(d);
  });

  it("is null for a document that holds no space", () => {
    expect(draftFromTurtle('<#me> <https://schema.org/name> "Not a space" .', base)).toBeNull();
  });

  it("leaves out a coordinate that isn't a plain decimal, never guesses", () => {
    const turtle = spaceFile(draft).turtle.replace("50.8391", '"north"');
    const d = draftFromTurtle(turtle, base)!;
    expect(d.lat).toBeUndefined();
    expect(d.lon).toBeUndefined();
    expect(d.name).toBe(draft.name);
  });

  it("throws on a file that isn't Turtle", () => {
    expect(() => draftFromTurtle("<html> nope", base)).toThrow();
  });
});

describe("a network (2026-11-19): it serves an area, it has no address", () => {
  /** Pinned to maps_of_making 51ba3ad (test/fixtures/README.md): Maakbib as the map reads it. */
  const maakbib = readFileSync(join(__dirname, "../../test/fixtures/maakbib.ttl"), "utf8");
  const base = "https://maakbib.pod.example/space.ttl";
  const network = {
    kind: "network" as const,
    name: "Maakbib",
    description: "MaakBib helpt bibliotheken en jeugdwerkingen met kennis en een netwerk om een maakplaats of fablab uit te bouwen en te runnen.",
    website: "https://maakbib.be/",
    logo: "https://maakbib.be/wp-content/uploads/2026/08/logo-maakbib-kleur.svg",
    email: "info@decreatievestem.be",
    areaServed: ["BE-VLG"],
    lat: "51.0378",
    lon: "4.2406",
    fidelity: "region",
  };

  it("says exactly the statements of the map's fixture for the same values", () => {
    const { turtle, dropped } = spaceFile(network);
    expect(dropped).toEqual([]);
    expect(statements(turtle)).toEqual(statements(maakbib));
  });

  it("types the node a network and an organisation, at <#space>, with no address", () => {
    const { turtle } = spaceFile(network);
    expect(turtle).toContain("<#space> a mom:Network, schema:Organization ;");
    expect(turtle).not.toContain("mom:Space");
    expect(turtle).not.toContain("schema:address");
    expect(turtle).not.toContain("PostalAddress");
  });

  it("reads the fixture back into the draft, and writes the same statements again (the round trip)", () => {
    const read = draftFromTurtle(maakbib, base)!;
    expect(read).toEqual({ ...network, country: "BE" });
    expect(sameStatements(spaceFile(read).turtle, maakbib)).toBe(true);
  });

  it("writes one statement per area, upper case, sorted, valid codes only; the street and town typed before are not written", () => {
    const { turtle } = spaceFile({ ...network, areaServed: ["be-vlg", "BE-BRU", "Flanders", "BE-VLG"], street: "Rue 1", city: "Gent", country: "BE" });
    const areas = statements(turtle).filter((s) => s.includes("schema.org/areaServed"));
    expect(areas).toEqual([
      `<https://pod.example/space.ttl#space> https://schema.org/areaServed "BE-BRU"^^http://www.w3.org/2001/XMLSchema#string`,
      `<https://pod.example/space.ttl#space> https://schema.org/areaServed "BE-VLG"^^http://www.w3.org/2001/XMLSchema#string`,
    ]);
    expect(turtle).not.toContain("Gent");
    expect(turtle).not.toContain("Rue 1");
  });

  it("requires a name, an area and a pin, and names what is missing", () => {
    const missing = (d: object) => {
      try {
        spaceFile(d);
        return [];
      } catch (e) {
        return (e as SpaceFileError).missing;
      }
    };
    expect(missing({ kind: "network" })).toEqual(["name", "area", "pin"]);
    expect(missing({ ...network, areaServed: ["Vlaanderen"] })).toEqual(["area"]);
    expect(missing({ ...network, lat: "north" })).toEqual(["pin"]);
  });

  it("writes a fidelity the map reads, else the one the area's shape gives; never anything else", () => {
    const fidelity = (d: object) => statements(spaceFile({ ...network, ...d }).turtle).find((s) => s.includes("geolocationFidelity"));
    expect(fidelity({ fidelity: "street" })).toContain('"region"');
    expect(fidelity({ fidelity: undefined, areaServed: ["BE"] })).toContain('"country"');
    expect(fidelity({ fidelity: "Country" })).toContain('"country"');
  });

  it("reads a space's file as before: no kind, no area, no fidelity", () => {
    const read = draftFromTurtle(fixture, base)!;
    expect(read.kind).toBeUndefined();
    expect(read.areaServed).toBeUndefined();
    expect(read.fidelity).toBeUndefined();
    expect(spaceFile(draft).turtle).not.toContain("geolocationFidelity");
  });
});

describe("draftFromStore: the draft kept in this browser, read back", () => {
  it("keeps text fields and a network's areas, cleaned; drops anything else", () => {
    expect(draftFromStore({ kind: "network", name: "Maakbib", areaServed: ["be-vlg", 3, "nope"], lat: 51, event: {} })).toEqual({
      kind: "network", name: "Maakbib", areaServed: ["BE-VLG"],
    });
    expect(draftFromStore({ kind: "garden", name: "Atelier", city: "Gent" })).toEqual({ name: "Atelier", city: "Gent" });
    expect(draftFromStore(null)).toEqual({});
    expect(draftFromStore(["x"])).toEqual({});
  });
});
