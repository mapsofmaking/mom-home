import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTree } from "../tree/parse";
import { miniMapSlot, mountMiniMaps } from "./minimap";
import { renderPreview } from "./previews";
import { IDLE, renderThreshold } from "./publish";

const tree = parseTree(readFileSync(join(__dirname, "../../public/onboarding.ttl"), "utf8"));
const keep = tree.tiles.find((t) => t.id === "keep")!;

describe("the small map behind a card (14.4 S6, #16)", () => {
  it("has a slot only for a real pin", () => {
    expect(miniMapSlot("50.8371", "4.3458")).toContain('data-lat="50.8371"');
    expect(miniMapSlot(50.8371, 4.3458)).toContain('data-lon="4.3458"');
    for (const [lat, lon] of [[undefined, "4"], ["", "4"], ["x", "4"], ["91", "4"], ["50", "181"]] as const) {
      expect(miniMapSlot(lat, lon), `${lat},${lon}`).toBe("");
    }
  });

  it("is hidden from screen readers: the card and the pin line say it in words", () => {
    expect(miniMapSlot(1, 2)).toContain('aria-hidden="true"');
  });

  it("tile A's card preview gets the map under its card once the draft has a pin, and stays paper without", () => {
    const withPin = document.createElement("div");
    withPin.innerHTML = renderPreview("mapcard", { name: "Weld Done", city: "Marolles", lat: "50.8371", lon: "4.3458" });
    expect(withPin.querySelector(".wb-frame > .wb-map")).not.toBeNull();
    expect(withPin.textContent).toContain("Preview · nothing is published");
    const without = document.createElement("div");
    without.innerHTML = renderPreview("mapcard", { name: "Weld Done" });
    expect(without.querySelector(".wb-map")).toBeNull();
  });

  it("the threshold shows the pin read back from the map: its card, the map under it, centred on the map's pin", () => {
    const html = document.createElement("div");
    html.innerHTML = renderThreshold(keep, {
      ...IDLE, file: "done", pub: "done", map: "done", fileUrl: "https://weld-done.pod.example/space.ttl",
      onMap: { id: "weld-done", link: "https://mapsofmaking.org/?space=weld-done", pin: { id: "weld-done", name: "Weld Done", lat: 50.8, lon: 4.3, city: "Marolles", country: "Belgium" } },
    }, "", tree.tiles.find((t) => t.id === "change"));
    // The way on says its name only: an arrow read as "this leaves the page" (Nicolas, live 2026-11-03).
    expect(html.querySelector(".wb-arrived-next [data-go]")!.textContent).toBe(tree.tiles.find((t) => t.id === "change")!.title);
    expect(html.querySelector(".wb-arrived-where .wb-frame")).not.toBeNull();
    const frame = html.querySelector(".wb-frame")!;
    expect(frame.querySelector(".sp-name")!.textContent).toBe("Weld Done");
    expect(frame.querySelector(".sp-address")!.textContent).toBe("Marolles, Belgium");
    expect(frame.querySelector<HTMLElement>(".wb-map")!.dataset.lat).toBe("50.8");
  });

  it("without WebGL (this runner, old browsers) nothing is loaded and the frame keeps its paper", async () => {
    const root = document.createElement("div");
    root.innerHTML = miniMapSlot(1, 2);
    await mountMiniMaps(root);
    expect(root.querySelector(".wb-map")!.hasAttribute("data-drawn")).toBe(false);
    expect(root.querySelector("canvas")).toBeNull();
  });
});
