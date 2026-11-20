import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { draftFromRecord, readSpaceFile, splitAddress, type ReadRecord, type ReadUrlAnswer } from "./spaceapi-read";
import { spaceApiJson } from "./spaceapi";
import { draftFromStore, draftFromTurtle, sameStatements, spaceFile, statements } from "./spacefile";

/** The map's live answers (POST /api/read-url, maps_of_making #84), saved 2026-11-20. */
const answer = (name: string) => JSON.parse(readFileSync(join(__dirname, `../../test/fixtures/read-url/${name}.json`), "utf8")) as ReadUrlAnswer;
const record = (name: string) => answer(name).record!;

describe("draftFromRecord: a file someone already has, as tile A's draft (#73)", () => {
  it("Ingegno: its four networks, its goals and topics, its contact, its pin by its town", () => {
    const { draft, notCarried } = draftFromRecord(record("ingegno"));
    expect(draft).toMatchObject({
      name: "Ingegno Maker Space",
      street: "Antoon Catriestraat 6, Drongen",
      postcode: "9031",
      city: "Gent",
      country: "BE",
      lat: "51.0503233",
      lon: "3.657383",
      place: "Gent",
      email: "info@decreatievestem.be",
      matrix: "#ingegnomakerspace:matrix.org",
      website: "https://decreatievestem.be",
      memberOf: ["urn:mak:network/vulca", "urn:mak:network/fabtafel", "urn:mak:network/maakbib", "urn:mak:network/ziezo"],
      sdgs: [4, 5, 9, 17],
    });
    expect(draft.knowsAbout).toHaveLength(9);
    expect(draft.kind).toBeUndefined();
    expect(notCarried).toEqual(["next_event", "state", "contact.facebook", "contact.instagram"]);
    expect(draft.notCarried).toEqual(notCarried);
  });

  it("Mother Sands: what the map left behind and what the draft can't hold are both named", () => {
    const { draft, notCarried } = draftFromRecord(record("mother-sands"));
    expect(notCarried).toEqual([
      "ext_canary", "ext_fab", "issue_report_channels", "state",
      "country_code: sol-3", "timezone: UTC+0", "contact.irc", "contact.twitter",
    ]);
    // Not an ISO code: left empty, the form asks for it.
    expect(draft.country).toBeUndefined();
    expect(draft.memberOf).toEqual(["urn:mak:network/canary", "urn:mak:network/vulca"]);
    expect(draft.sdgs).toEqual([9, 11, 12, 14, 17]);
    expect(draft.hours).toMatch(/^closed during low tide/);
  });

  it("Maakbib's pod file: a network, its area and fidelity, no address", () => {
    const { draft, notCarried } = draftFromRecord(record("maakbib-pod"));
    expect(draft).toMatchObject({ kind: "network", name: "maakbib", areaServed: [{ code: "BE-VLG", name: "Flanders" }], country: "BE", fidelity: "region" });
    expect(draft.street).toBeUndefined();
    expect(draft.place).toBeUndefined();
    expect(notCarried).toEqual([]);
    expect(draft.notCarried).toBeUndefined();
  });

  it("never carries a network the map wouldn't read, and says so", () => {
    const base = record("ingegno");
    const { draft, notCarried } = draftFromRecord({ ...base, memberOf: ["javascript:alert(1)", "urn:mak:space/x", "urn:mak:network/ok", "https://pod.example/config.ttl#net"] });
    expect(draft.memberOf).toEqual(["urn:mak:network/ok", "https://pod.example/config.ttl#net"]);
    expect(notCarried).toContain("memberOf: javascript:alert(1)");
    expect(notCarried).toContain("memberOf: urn:mak:space/x");
  });

  it("leaves out a web address that isn't http(s), and a pin out of range", () => {
    const r: ReadRecord = { ...record("ingegno"), logo: "data:image/png;base64,xx", lat: 120 };
    const { draft, notCarried } = draftFromRecord(r);
    expect(draft.logo).toBeUndefined();
    expect(draft.lat).toBeUndefined();
    expect(draft.place).toBeUndefined();
    expect(notCarried.some((k) => k.startsWith("logo: data:"))).toBe(true);
  });
});

describe("splitAddress: best-effort, the pin doesn't depend on it", () => {
  it.each([
    ["Rue du Canal 12, 1000 Bruxelles, BE", { street: "Rue du Canal 12", postcode: "1000", city: "Bruxelles" }],
    ["Antoon Catriestraat 6, Drongen, Gent, 9031", { street: "Antoon Catriestraat 6, Drongen", postcode: "9031", city: "Gent" }],
    ["Maunsell Fort, North Sea", { street: "Maunsell Fort", postcode: "", city: "North Sea" }],
    ["Gent", { street: "", postcode: "", city: "Gent" }],
    ["", { street: "", postcode: "", city: "" }],
  ])("%s", (address, parts) => {
    expect(splitAddress(address)).toEqual(parts);
  });
});

describe("what an import brings survives every step to the pod (#73)", () => {
  const { draft } = draftFromRecord(record("ingegno"));

  it("the draft kept in this browser keeps the lists and the not-carried line", () => {
    const kept = draftFromStore(JSON.parse(JSON.stringify(draft)));
    expect(kept.memberOf).toEqual(draft.memberOf);
    expect(kept.sdgs).toEqual(draft.sdgs);
    expect(kept.knowsAbout).toEqual(draft.knowsAbout);
    expect(kept.notCarried).toEqual(draft.notCarried);
  });

  it("space.ttl carries them, and reading it back writes the same statements (signed-in round trip)", () => {
    const { turtle } = spaceFile(draft);
    const lines = statements(turtle);
    expect(lines.filter((l) => l.includes("mom#memberOf"))).toHaveLength(4);
    expect(lines.filter((l) => l.includes("mom#sdgs"))).toHaveLength(4);
    expect(lines.filter((l) => l.includes("schema.org/knowsAbout"))).toHaveLength(9);
    const back = draftFromTurtle(turtle, "https://pod.example/space.ttl")!;
    expect(back.memberOf).toEqual(draft.memberOf);
    expect(back.sdgs).toEqual(draft.sdgs);
    expect(back.knowsAbout).toEqual(draft.knowsAbout);
    expect(sameStatements(spaceFile(back).turtle, turtle)).toBe(true);
  });

  it("the self-host JSON carries them where the map reads them", () => {
    const json = JSON.parse(spaceApiJson(draft).json);
    expect(json.knowsAbout).toEqual(draft.knowsAbout);
    expect(json.mom).toEqual({ memberOf: draft.memberOf, sdgs: draft.sdgs });
  });
});

describe("readSpaceFile: the map's answer", () => {
  const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("asks /api/read-url on this origin, and makes the draft", async () => {
    const f = reply(200, answer("maakbib-pod"));
    const out = await readSpaceFile("https://maakbib.pod.mapsofmaking.org/space.ttl", f);
    expect("draft" in out && out.draft.kind).toBe("network");
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/api/read-url");
  });

  it("says why a file can't be read, busy or away", async () => {
    expect(await readSpaceFile("https://x.example/f", reply(200, { validation: { error: "HTTP 404" }, record: null }))).toEqual({ problem: "unread", error: "HTTP 404" });
    expect(await readSpaceFile("https://x.example/f", reply(429, {}))).toEqual({ problem: "rate" });
    expect(await readSpaceFile("https://x.example/f", reply(502, {}))).toEqual({ problem: "unavailable" });
    const down = vi.fn(async () => { throw new TypeError("offline"); }) as unknown as typeof fetch;
    expect(await readSpaceFile("https://x.example/f", down)).toEqual({ problem: "unavailable" });
  });
});

describe("nothing is cut or dropped unsaid (review of #73)", () => {
  const base = () => record("ingegno");

  it("never cuts an address or a handle: too long, it is left out and named", () => {
    const long = "https://example.org/" + "a".repeat(600);
    const { draft, notCarried } = draftFromRecord({ ...base(), url: long, contact: { email: "x".repeat(400) + "@e.org" } });
    expect(draft.website).toBeUndefined();
    expect(draft.email).toBeUndefined();
    expect(notCarried.some((k) => k.startsWith("url: https://example.org/"))).toBe(true);
    expect(notCarried.some((k) => k.startsWith("contact.email: "))).toBe(true);
  });

  it("says when a text is cut, and keeps a description up to the map's 5000", () => {
    const { draft, notCarried } = draftFromRecord({ ...base(), name: "N".repeat(250), description: "d".repeat(4000) });
    expect(draft.name).toHaveLength(200);
    expect(notCarried).toContain("name (cut at 200 characters)");
    expect(draft.description).toHaveLength(4000);
  });

  it("names every network, goal and topic it doesn't keep, and coordinates out of range", () => {
    const many = Array.from({ length: 52 }, (_, i) => "t" + i);
    const { notCarried } = draftFromRecord({ ...base(), knowsAbout: [...many, ""], memberOf: ["javascript:x"], sdgs: [4, 30], lat: 95 });
    expect(notCarried).toContain("knowsAbout: t50");
    expect(notCarried).toContain("knowsAbout: t51");
    expect(notCarried).toContain("knowsAbout: ");
    expect(notCarried).toContain("memberOf: javascript:x");
    expect(notCarried).toContain("sdgs: 30");
    expect(notCarried).toContain("lat/lon: 95, 3.657383");
  });

  it("a network: an area, a fidelity or a country it can't keep are named", () => {
    const { draft, notCarried } = draftFromRecord({ ...record("maakbib-pod"), areaServed: [{ code: "BE-VLG", name: "Flanders" }, { code: "Vlaanderen", name: "" }], geolocationFidelity: "street", country_code: "NL" });
    expect(draft.areaServed).toEqual([{ code: "BE-VLG", name: "Flanders" }]);
    expect(notCarried).toEqual(["areaServed: VLAANDEREN", "country_code: NL", "geolocationFidelity: street"]);
  });

  it.each([
    ["Springfield, IL 62701", "Springfield"],
    ["221B Baker Street, London SW1A 1AA", "London SW1A 1AA"],
  ])("doesn't read %s as a town and a postcode it isn't", (address, city) => {
    expect(splitAddress(address).city).toBe(city);
  });

  it("marks the pin as the file's own, so a country typed after doesn't move it", () => {
    expect(draftFromRecord(base()).draft.pinFrom).toBe("file");
    expect(draftFromRecord(record("maakbib-pod")).draft.pinFrom).toBeUndefined();
  });
});
