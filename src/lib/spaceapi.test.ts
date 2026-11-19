import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { spaceApiFilename, spaceApiJson } from "./spaceapi";
import { draftFromTurtle, sameStatements, spaceFile, SpaceFileError } from "./spacefile";

/** Pinned to maps_of_making c349f22 (test/fixtures/README.md): the space as the map reads it, in both formats. */
const fixture = (ext: string) => readFileSync(join(__dirname, "../../test/fixtures/atelier-du-canal." + ext), "utf8");
const draft = draftFromTurtle(fixture("ttl"), "https://pod.example/space.ttl")!;

describe("the SpaceAPI file is the file the map reads", () => {
  it("turns the fixture's Turtle into the fixture's JSON", () => {
    const { json, dropped } = spaceApiJson(draft);
    expect(dropped).toEqual([]);
    expect(JSON.parse(json)).toEqual(JSON.parse(fixture("json")));
  });

  it("is deterministic and pretty-printed, keys in the fixture's order", () => {
    const { json } = spaceApiJson(draft);
    expect(spaceApiJson({ ...draft }).json).toBe(json);
    expect(json).toContain('\n  "space": "Atelier du Canal"');
    expect(Object.keys(JSON.parse(json))).toEqual(Object.keys(JSON.parse(fixture("json"))));
  });

  it("writes the address without a street as '<postcode> <city>, <CC>', and coordinates as numbers", () => {
    const { json } = spaceApiJson({ ...draft, street: undefined });
    const file = JSON.parse(json);
    expect(file.location.address).toBe("1070 Anderlecht, BE");
    expect(file.location.lat).toBe(50.8391);
    expect(typeof file.location.lon).toBe("number");
    expect(JSON.parse(spaceApiJson({ name: "x", city: "Marolles", country: "be", lat: "50.8", lon: "4.3" }).json).location.address).toBe("Marolles, BE");
  });

  it("carries a good website, logo and hours, and leaves out an address that is not a web address", () => {
    const good = JSON.parse(spaceApiJson({ ...draft, website: "https://welddone.example/", logo: "https://welddone.example/logo.png", hours: "Tu-Sa 10:00-18:00" }).json);
    expect(good.url).toBe("https://welddone.example/");
    expect(good.logo).toBe("https://welddone.example/logo.png");
    expect(good.opening_hours).toBe("Tu-Sa 10:00-18:00");
    const bad = spaceApiJson({ ...draft, website: "javascript:alert(1)", logo: "ftp://x.example/logo.png", matrix: "not a room" });
    expect(bad.dropped).toEqual(["logo", "website", "matrix"]);
    const file = JSON.parse(bad.json);
    expect(file.url).toBeUndefined();
    expect(file.logo).toBeUndefined();
    expect(file.contact).toEqual({ email: "contact@atelierducanal.example" });
  });

  it("refuses a draft with no name, town, country or pin, like the Turtle writer", () => {
    expect(() => spaceApiJson({})).toThrow(SpaceFileError);
    try {
      spaceApiJson({ name: "x", city: "y", country: "Belgium", lat: "50.8", lon: "" });
    } catch (e) {
      expect((e as SpaceFileError).missing).toEqual(["country", "pin"]);
    }
  });

  it("names the download after the space", () => {
    expect(spaceApiFilename(draft)).toBe("atelier-du-canal.json");
    expect(spaceApiFilename({ name: "Café  Réparation!" })).toBe("cafe-reparation.json");
    expect(spaceApiFilename({})).toBe("space.json");
  });
});

describe("a network's SpaceAPI file (2026-11-19)", () => {
  /** Maakbib as the map reads it (test/fixtures/README.md: 51ba3ad, areas as nodes since the area search), in both formats. */
  const maakbib = (ext: string) => readFileSync(join(__dirname, "../../test/fixtures/maakbib." + ext), "utf8");
  const network = draftFromTurtle(maakbib("ttl"), "https://maakbib.pod.example/space.ttl")!;

  it("turns the fixture's Turtle into the fixture's JSON, and back into the same statements", () => {
    const { json, dropped } = spaceApiJson(network);
    expect(dropped).toEqual([]);
    expect(JSON.parse(json)).toEqual(JSON.parse(maakbib("json")));
    expect(Object.keys(JSON.parse(json))).toEqual(Object.keys(JSON.parse(maakbib("json"))));
    expect(sameStatements(spaceFile(network).turtle, maakbib("ttl"))).toBe(true);
  });

  it("has no address; the country is the one its areas share, and none when they span several", () => {
    expect(JSON.parse(spaceApiJson(network).json).location).toEqual({ country_code: "BE", lat: 51.0378, lon: 4.2406 });
    const two = JSON.parse(spaceApiJson({ ...network, areaServed: [{ code: "BE-VLG", name: "Flanders" }, { code: "NL", name: "" }] }).json);
    expect(two.location).toEqual({ lat: 51.0378, lon: 4.2406 });
    // Code then name; a name not known is left out, as in the Turtle.
    expect(two.mom.areaServed).toEqual([{ code: "BE-VLG", name: "Flanders" }, { code: "NL" }]);
    expect(Object.keys(two.mom.areaServed[0])).toEqual(["code", "name"]);
  });

  it("refuses a network with no area, as the Turtle does", () => {
    expect(() => spaceApiJson({ ...network, areaServed: [] })).toThrow(SpaceFileError);
  });
});
