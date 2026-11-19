import { afterEach, describe, expect, it, vi } from "vitest";
import { findArea, findPlace, timing } from "./where";

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

describe("the geocoder, asked for a network's area (findArea, 2026-11-19)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends the area code only, and gives the centre back", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ lat: 51.0378, lon: 4.2406, country_code: "be", postcode: null, display_name: "Vlaanderen", fidelity: "region", area: "BE-VLG" }))
    );
    expect(await findArea("BE-VLG")).toMatchObject({ answer: { lat: 51.0378, lon: 4.2406, fidelity: "region" } });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/geocode");
    expect(JSON.parse(init!.body as string)).toEqual({ area: "BE-VLG" });
  });

  it("nothing found, too many asks, no answer: said as such", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ lat: null, lon: null, area: "BE-VLG" })));
    expect(await findArea("BE-VLG")).toBe("none");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 429 }));
    expect(await findArea("BE-VLG")).toBe("rate");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    expect(await findArea("BE-VLG")).toBe("unavailable");
  });
});
