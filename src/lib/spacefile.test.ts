import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { areaLabel, cleanAreaName, cleanAreas, draftFromStore, draftFromTurtle, iri, literal, matrixLink, sameStatements, spaceFile, SpaceFileError, statements } from "./spacefile";

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
  /** Maakbib as the map reads it (test/fixtures/README.md: 51ba3ad, areas as nodes since the area search). */
  const maakbib = readFileSync(join(__dirname, "../../test/fixtures/maakbib.ttl"), "utf8");
  const base = "https://maakbib.pod.example/space.ttl";
  const network = {
    kind: "network" as const,
    name: "Maakbib",
    description: "MaakBib helpt bibliotheken en jeugdwerkingen met kennis en een netwerk om een maakplaats of fablab uit te bouwen en te runnen.",
    website: "https://maakbib.be/",
    logo: "https://maakbib.be/wp-content/uploads/2026/08/logo-maakbib-kleur.svg",
    email: "info@decreatievestem.be",
    areaServed: [{ code: "BE-VLG", name: "Flanders" }],
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

  it("does not read a stray address on a network: the country stays the one its areas share (review of #67)", () => {
    const stray = maakbib.replace(/\.\s*$/, ` ;\n  schema:address [ schema:addressLocality "Paris" ; schema:addressCountry "FR" ] .\n`);
    const read = draftFromTurtle(stray, base)!;
    expect(read.country).toBe("BE");
    expect(read.city).toBeUndefined();
  });

  it("writes one node per area (code and name), upper case, sorted by code, valid codes only; the street and town typed before are not written", () => {
    const areaServed = [
      { code: "be-vlg", name: " Flanders " }, { code: "BE-BRU", name: "Brussels" }, { code: "Flanders", name: "Flanders" }, { code: "BE-VLG", name: "Twice" },
    ];
    const { turtle } = spaceFile({ ...network, areaServed, street: "Rue 1", city: "Gent", country: "BE" });
    expect(turtle).toContain(
      `schema:areaServed [ a schema:AdministrativeArea ; schema:identifier "BE-BRU" ; schema:name "Brussels" ] ;\n` +
      `  schema:areaServed [ a schema:AdministrativeArea ; schema:identifier "BE-VLG" ; schema:name "Flanders" ] ;`
    );
    expect(turtle).not.toContain("Twice");
    expect(turtle).not.toContain("Gent");
    expect(turtle).not.toContain("Rue 1");
  });

  it("escapes an area's name, cuts one over 200 characters as the map does, and writes no name it doesn't know", () => {
    const named = (name: string) => spaceFile({ ...network, areaServed: [{ code: "FR-IDF", name }] }).turtle;
    expect(named('Île "de" France')).toContain(`schema:identifier "FR-IDF" ; schema:name "Île \\"de\\" France" ]`);
    expect(named("x".repeat(201))).toContain(`schema:identifier "FR-IDF" ; schema:name "${"x".repeat(200)}" ]`);
    expect(named("")).not.toContain("schema:name \"\"");
    expect(sameStatements(named('Île "de" France'), named('Île "de" France'))).toBe(true);
  });

  it("keeps one area per code as the map's clean_areas does: a name beats none, then the smaller name", () => {
    expect(cleanAreas(["BE-VLG", { code: "be-vlg", name: "Vlaanderen" }, { code: "BE-VLG", name: "Flanders" }, { code: "BE-BRU", name: "Brussels" }])).toEqual([
      { code: "BE-BRU", name: "Brussels" }, { code: "BE-VLG", name: "Flanders" },
    ]);
    expect(cleanAreas([{ code: "BE-VLG", name: "Flanders" }, "BE-VLG"])).toEqual([{ code: "BE-VLG", name: "Flanders" }]);
    // A file holding both shapes (a bare code and the node) reads the named one, whatever the order.
    const both = maakbib.replace("schema:areaServed [", `schema:areaServed "BE-VLG" ;\n  schema:areaServed [`);
    expect(draftFromTurtle(both, base)!.areaServed).toEqual([{ code: "BE-VLG", name: "Flanders" }]);
  });

  it("cleans an area's name as the map's clean_area_name does: no control characters, one space, trimmed, cut at 200", () => {
    expect(cleanAreaName("  Île-de-\nFrance\t\u0007 (FR)  ")).toBe("Île-de- France (FR)");
    expect(cleanAreaName(3)).toBe("");
    expect(cleanAreaName(`${"é".repeat(199)}🙂🙂`)).toBe(`${"é".repeat(199)}🙂`);
  });

  it("labels a nameless area as the map does: its subdivisions by name, a country by its English name, else the code", () => {
    expect(areaLabel({ code: "BE-VLG", name: "" })).toBe("Flanders");
    expect(areaLabel({ code: "BE-BRU", name: "" })).toBe("Brussels");
    expect(areaLabel({ code: "FR", name: "" })).toBe("France");
    expect(areaLabel({ code: "FR-IDF", name: "" })).toBe("FR-IDF");
  });

  it("still reads the bare code a file from #67 wrote, with no name", () => {
    const old = maakbib.replace(/schema:areaServed \[[^\]]*\]/, `schema:areaServed "BE-VLG"`);
    expect(old).toContain(`schema:areaServed "BE-VLG" ;`);
    const read = draftFromTurtle(old, base)!;
    expect(read.areaServed).toEqual([{ code: "BE-VLG", name: "" }]);
    expect(read.country).toBe("BE");
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
    expect(missing({ ...network, areaServed: [{ code: "Vlaanderen", name: "Vlaanderen" }] })).toEqual(["area"]);
    expect(missing({ ...network, lat: "north" })).toEqual(["pin"]);
  });

  it("writes a fidelity the map reads, else the one the area's shape gives; never anything else", () => {
    const fidelity = (d: object) => statements(spaceFile({ ...network, ...d }).turtle).find((s) => s.includes("geolocationFidelity"));
    expect(fidelity({ fidelity: "street" })).toContain('"region"');
    expect(fidelity({ fidelity: undefined, areaServed: [{ code: "BE", name: "Belgium" }] })).toContain('"country"');
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
    expect(
      draftFromStore({ kind: "network", name: "Maakbib", areaServed: [{ code: "fr-idf", name: "Île-de-France" }, 3, "nope", { name: "x" }], lat: 51, event: {} })
    ).toEqual({ kind: "network", name: "Maakbib", areaServed: [{ code: "FR-IDF", name: "Île-de-France" }] });
    // A draft kept by #67 holds bare codes: read as areas with no name.
    expect(draftFromStore({ kind: "network", areaServed: ["be-vlg"] })).toEqual({ kind: "network", areaServed: [{ code: "BE-VLG", name: "" }] });
    expect(draftFromStore({ kind: "garden", name: "Atelier", city: "Gent" })).toEqual({ name: "Atelier", city: "Gent" });
    // A string where the list should be: dropped, never passed on to cleanAreas (review of #67).
    expect(draftFromStore({ kind: "network", name: "Maakbib", areaServed: "BE-VLG" })).toEqual({ kind: "network", name: "Maakbib" });
    expect(draftFromStore(null)).toEqual({});
    expect(draftFromStore(["x"])).toEqual({});
  });
});
