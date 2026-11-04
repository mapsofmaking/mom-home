import { describe, expect, it } from "vitest";
import { livePopup } from "./popup";
import type { Pin } from "../lib/onmap";

const pin = (over: Partial<Pin> = {}): Pin => ({
  id: "openfab", name: "OpenFab", lat: 50.8, lon: 4.3, city: "Brussels", country: "Belgium", hours: "", address: "", logo: "", ...over,
});
const draw = (p: Pin) => {
  const el = document.createElement("div");
  el.innerHTML = livePopup(p);
  return el;
};

describe("the card as the map's embed draws it", () => {
  it("the name with the logo beside it, then the address the map shows", () => {
    const el = draw(pin({ address: "158, Rue Gray, 1050 Brussels, Belgium", logo: "https://openfab.pod.example/logo" }));
    expect(el.querySelector(".sp-name-row .sp-name")!.textContent).toBe("OpenFab");
    const img = el.querySelector<HTMLImageElement>(".sp-name-row .sp-logo img")!;
    expect(img.getAttribute("src")).toBe("https://openfab.pod.example/logo");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(el.querySelector(".sp-address")!.textContent).toBe("158, Rue Gray, 1050 Brussels, Belgium");
    expect(el.querySelector(".wb-popup-foot")).not.toBeNull();
  });

  it("no logo, or one that isn't a web address: the placeholder; no address: the city and country", () => {
    for (const logo of ["", "javascript:alert(1)", "data:image/png;base64,AA"]) {
      const el = draw(pin({ logo }));
      expect(el.querySelector(".sp-logo.is-placeholder svg")).not.toBeNull();
      expect(el.querySelector(".sp-logo img")).toBeNull();
      expect(el.querySelector(".sp-address")!.textContent).toBe("Brussels, Belgium");
    }
  });

  it("the name and address are text, never markup", () => {
    const el = draw(pin({ name: "<b>x</b>", address: "<img src=x>", logo: 'https://x.example/a"onerror="1' }));
    expect(el.querySelector("b")).toBeNull();
    expect(el.querySelectorAll("img").length).toBe(1);
    expect(el.querySelector("img")!.getAttribute("onerror")).toBeNull();
  });
});
