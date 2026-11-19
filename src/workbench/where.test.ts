import { afterEach, describe, expect, it, vi } from "vitest";
import { candidateLabel, findPlace, searchAreas, timing } from "./where";

const answer = (lat: number | null, over = {}) =>
  new Response(JSON.stringify({ lat, lon: lat === null ? null : 4.38, country_code: "be", postcode: "1050", display_name: "Ixelles", ...over }));

describe("the geocoder, asked as tile A asks it (findPlace; tile A's pin, tile C's move)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("asks the proxy on home's own origin for the street in the city", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(answer(50.83));
    const found = await findPlace("158 Rue Gray", "Ixelles");
    expect(found).toMatchObject({ answer: { lat: 50.83, lon: 4.38 }, missed: false });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/geocode");
    expect(JSON.parse(init!.body as string)).toEqual({ address: "158 Rue Gray", city: "Ixelles", postcode: "", country_code: "" });
  });

  it("the street finds nothing: the city alone, a second later, said as missed", async () => {
    vi.spyOn(timing, "retryGap", "get").mockReturnValue(0);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(answer(null)).mockResolvedValueOnce(answer(50.82));
    expect(await findPlace("Nope 9", "Ixelles")).toMatchObject({ answer: { lat: 50.82 }, missed: true });
    expect(JSON.parse(fetchSpy.mock.calls[1][1]!.body as string).address).toBe("");
  });

  it("nothing found, too many asks, or no answer: said as such, never a place", async () => {
    vi.spyOn(timing, "retryGap", "get").mockReturnValue(0);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => answer(null));
    expect(await findPlace("Nowhere 1", "Atlantis")).toBe("none");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 429 }));
    expect(await findPlace("", "Ixelles")).toBe("rate");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    expect(await findPlace("", "Ixelles")).toBe("unavailable");
  });
});

describe("the geocoder, asked for the areas a name could be (searchAreas, 2026-11-19)", () => {
  afterEach(() => vi.restoreAllMocks());
  const VLG = { code: "BE-VLG", name: "Flanders", display_name: "Vlaanderen, België / Belgique / Belgien", lat: 51.0377778, lon: 4.2405556, fidelity: "region" };
  const reply = (candidates: unknown) => new Response(JSON.stringify({ candidates }));

  it("sends the text and the language only, and gives the candidates back", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply([VLG]));
    expect(await searchAreas("Flanders")).toEqual([VLG]);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/geocode");
    expect(init!.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toEqual({ area_search: "Flanders", lang: "en" });
  });

  it("offers five at most, and only what can be picked: a code the map reads, a name, a centre on the globe", async () => {
    const more = ["FR", "FR-IDF", "DE", "NL", "PT", "ES"].map((code) => ({ ...VLG, code, name: code }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      reply([{ ...VLG, code: "Vlaanderen" }, { ...VLG, name: "" }, { ...VLG, lat: null }, { ...VLG, lon: 200 }, "x", { ...VLG, code: "be-vlg", fidelity: "street" }, VLG, ...more])
    );
    const found = await searchAreas("Fl");
    expect(Array.isArray(found) && found.map((c) => c.code)).toEqual(["BE-VLG", "FR", "FR-IDF", "DE", "NL"]);
    // A fidelity the map doesn't read gives way to the code's shape.
    expect(Array.isArray(found) && found[0].fidelity).toBe("region");
  });

  it("no candidate, too many asks, no answer: said as such", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(reply([]));
    expect(await searchAreas("Atlantis")).toBe("none");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 429 }));
    expect(await searchAreas("Flanders")).toBe("rate");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 502 }));
    expect(await searchAreas("Flanders")).toBe("unavailable");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    expect(await searchAreas("Flanders")).toBe("unavailable");
  });

  it("names a region with its country, a country alone", () => {
    expect(candidateLabel({ code: "BE-VLG", name: "Flanders" })).toBe("Flanders, Belgium");
    expect(candidateLabel({ code: "FR", name: "France" })).toBe("France");
  });
});
