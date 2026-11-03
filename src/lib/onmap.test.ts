import { describe, expect, it } from "vitest";
import { idFromSpaceUri, lookupOnMap, mapLink, putOnMap, readPin, readPublished, registerOnMap } from "./onmap";

const FILE = "https://weld-done.pod.example/space.ttl";
type Call = { url: string; init?: RequestInit };

/** A map that registers, then shows the pin after `lag` pin requests. */
function fakeMap(opts: { register?: () => Response; lag?: number; pin?: () => Response } = {}) {
  const calls: Call[] = [];
  let pins = 0;
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === "/api/register-url") {
      return opts.register?.() ?? new Response(JSON.stringify({ status: "confirmed", space_uri: "urn:mak:space/weld-done" }), { status: 200 });
    }
    if (url === "/api/space/weld-done/pin") {
      if (pins++ < (opts.lag ?? 0)) return new Response("{}", { status: 404 });
      return opts.pin?.() ?? new Response(JSON.stringify({ id: "weld-done", name: "Weld Done", lat: 50.8371, lon: 4.3458, city: "Marolles", country: "Belgium" }), { status: 200 });
    }
    return new Response("", { status: 500 });
  };
  return { calls, fetchImpl };
}

describe("on the map (14.4 S3, #13)", () => {
  it("takes the map's id from its answer, and nothing else", () => {
    expect(idFromSpaceUri("urn:mak:space/weld-done")).toBe("weld-done");
    for (const bad of ["urn:mak:canary/mother-sands", "urn:mak:space/../x", "weld-done", 42, null]) expect(idFromSpaceUri(bad)).toBeNull();
    expect(mapLink("weld-done")).toBe("https://mapsofmaking.org/?space=weld-done");
  });

  it("registers the file's address through home's own /api/ proxy", async () => {
    const map = fakeMap();
    expect(await registerOnMap(FILE, map.fetchImpl)).toBe("weld-done");
    expect(map.calls[0].url).toBe("/api/register-url");
    expect(map.calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(map.calls[0].init?.body))).toEqual({ url: FILE });
  });

  it("tells the map saying no apart from the map being down or silent", async () => {
    await expect(registerOnMap(FILE, fakeMap({ register: () => new Response("{}", { status: 422 }) }).fetchImpl)).rejects.toMatchObject({ code: "map-refused" });
    await expect(registerOnMap(FILE, fakeMap({ register: () => new Response("", { status: 502 }) }).fetchImpl)).rejects.toMatchObject({ code: "map-down", status: 502 });
    await expect(registerOnMap(FILE, fakeMap({ register: () => new Response("<html>", { status: 200 }) }).fetchImpl)).rejects.toMatchObject({ code: "map-down" });
    await expect(registerOnMap(FILE, fakeMap({ register: () => new Response(JSON.stringify({ space_uri: "nope" }), { status: 200 }) }).fetchImpl)).rejects.toMatchObject({ code: "map-down" });
    await expect(registerOnMap(FILE, async () => { throw new TypeError("offline"); })).rejects.toMatchObject({ code: "unreachable" });
  });

  it("reads the pin as the map draws it; not drawn yet is null, not an error", async () => {
    expect(await readPin("weld-done", fakeMap().fetchImpl)).toEqual({ id: "weld-done", name: "Weld Done", lat: 50.8371, lon: 4.3458, city: "Marolles", country: "Belgium" });
    expect(await readPin("weld-done", fakeMap({ lag: 1 }).fetchImpl)).toBeNull();
  });

  it("waits for a pin that lags the registration, briefly", async () => {
    const map = fakeMap({ lag: 2 });
    const on = await putOnMap(FILE, map.fetchImpl, { total: 1000, every: 1 });
    expect(on.pin?.lat).toBe(50.8371);
    expect(on.link).toBe("https://mapsofmaking.org/?space=weld-done");
    expect(map.calls.filter((c) => c.url.endsWith("/pin"))).toHaveLength(3);
  });

  it("a pin that doesn't come in time is not a failure: the space is registered", async () => {
    const on = await putOnMap(FILE, fakeMap({ lag: 1_000 }).fetchImpl, { total: 5, every: 1 });
    expect(on).toMatchObject({ id: "weld-done", pin: null });
    const broken = await putOnMap(FILE, fakeMap({ pin: () => new Response("", { status: 500 }) }).fetchImpl, { total: 5, every: 1 });
    expect(broken.pin).toBeNull();
  });
});

describe("on the map, read at sign-in (14.4 S4, #14)", () => {
  const map = (lookup: number, id = "weld-done") => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      if (url.startsWith("/api/space-by-endpoint?url=")) return new Response(JSON.stringify({ id }), { status: lookup });
      if (url === `/api/space/${id}/pin`) return new Response(JSON.stringify({ id, name: "Weld Done", lat: 50.8, lon: 4.3, city: "Marolles", country: "BE" }), { status: 200 });
      return new Response("", { status: 500 });
    };
    return { calls, fetchImpl };
  };

  it("asks the map by the file's address, encoded", async () => {
    const m = map(200);
    expect(await lookupOnMap(FILE, m.fetchImpl)).toBe("weld-done");
    expect(m.calls[0]).toBe(`/api/space-by-endpoint?url=${encodeURIComponent(FILE)}`);
    expect(await lookupOnMap(FILE, map(404).fetchImpl)).toBeNull();
    expect(await lookupOnMap(FILE, map(200, "../x").fetchImpl)).toBeNull();
  });

  it("is on the map only when the map holds it AND a stranger can read it; failures are 'not yet'", async () => {
    expect(await readPublished(FILE, async () => true, map(200).fetchImpl)).toMatchObject({ id: "weld-done", pin: { city: "Marolles" } });
    expect(await readPublished(FILE, async () => false, map(200).fetchImpl)).toBeNull();
    expect(await readPublished(FILE, async () => true, map(404).fetchImpl)).toBeNull();
    expect(await readPublished(FILE, async () => true, map(500).fetchImpl)).toBeNull();
    expect(await readPublished(FILE, async () => { throw new Error("x"); }, map(200).fetchImpl)).toBeNull();
  });
});
