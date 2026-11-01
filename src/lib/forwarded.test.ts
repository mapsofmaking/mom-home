import { describe, expect, it } from "vitest";
import { hasForwarded, readForwarded } from "./forwarded";

const pack = (o: unknown) =>
  "#from-genjson=" +
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

describe("a draft forwarded from genjson", () => {
  it("maps genjson's fields to home's and leaves the pin to the geocoder", () => {
    const d = readForwarded(
      pack({
        space: "Atelier du Canal",
        address: "Quai 4",
        city: "Bruxelles",
        postcode: "1000",
        country_code: "be",
        lat: 50.85,
        lon: 4.35,
        description: "Café & atelier, é",
        contact_email: "a@b.be",
        contact_matrix: "@a:b.be",
        url: "https://x.be",
        logo: "https://x.be/l.svg",
      })
    );
    expect(d).toEqual({
      name: "Atelier du Canal",
      street: "Quai 4",
      city: "Bruxelles",
      description: "Café & atelier, é",
      email: "a@b.be",
      matrix: "@a:b.be",
      website: "https://x.be",
      logo: "https://x.be/l.svg",
    });
  });

  it("keeps text only, trimmed and cut to a length", () => {
    const d = readForwarded(pack({ space: "  Lab  ", city: 12, address: { a: 1 }, description: "x".repeat(5000) }));
    expect(d?.name).toBe("Lab");
    expect(d?.city).toBeUndefined();
    expect(d?.street).toBeUndefined();
    expect(d?.description).toHaveLength(2000);
  });

  it("ignores what is not a draft: absent, malformed, empty, wrong shape, unknown keys", () => {
    expect(readForwarded("")).toBeNull();
    expect(readForwarded("#other=abc")).toBeNull();
    expect(readForwarded("#from-genjson=!!!")).toBeNull();
    expect(readForwarded("#from-genjson=bm90IGpzb24")).toBeNull(); // "not json"
    expect(readForwarded(pack([]))).toBeNull();
    expect(readForwarded(pack({ space: "", city: "  " }))).toBeNull();
    expect(readForwarded(pack({ evil: "x", __proto__: { name: "y" } }))).toBeNull();
  });

  it("knows a forwarded hash even when it cannot be read", () => {
    expect(hasForwarded("#from-genjson=!!!")).toBe(true);
    expect(hasForwarded("#from-genjson=")).toBe(true);
    expect(hasForwarded("#top")).toBe(false);
    expect(hasForwarded("")).toBe(false);
  });
});
