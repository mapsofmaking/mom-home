import { describe, expect, it } from "vitest";
import { DONE_CHECKS } from "./done";

const base = { webId: "https://a.pod.example/profile/card#me", podRoot: "https://a.pod.example/" };
const space = "https://a.pod.example/space.ttl#space";
const full = { name: "Weld Done", city: "Marolles", lat: "50.8", lon: "4.3" };

describe("done is read from the space's file (#11)", () => {
  it("describe: the file says a name, a town and a pin", async () => {
    expect(await DONE_CHECKS.describe({ ...base, space, spaceData: full })).toBe(true);
    expect(await DONE_CHECKS.describe({ ...base, space, spaceData: { ...full, lat: undefined } })).toBe(false);
    expect(await DONE_CHECKS.describe({ ...base, space: null, spaceData: null })).toBe(false);
  });

  it("describe, for a network (2026-11-19): a name, an area and a pin; no town", async () => {
    const network = { kind: "network" as const, name: "Maakbib", areaServed: ["BE-VLG"], lat: "51.0378", lon: "4.2406" };
    expect(await DONE_CHECKS.describe({ ...base, space, spaceData: network })).toBe(true);
    expect(await DONE_CHECKS.describe({ ...base, space, spaceData: { ...network, areaServed: [] } })).toBe(false);
  });

  it("keep: a file in the pod is not published until it is on the map (S3)", async () => {
    expect(await DONE_CHECKS.keep({ ...base, space, spaceData: full })).toBe(false);
    expect(await DONE_CHECKS.keep({ ...base, space, spaceData: full, onMap: true })).toBe(true);
  });
});
