import { describe, expect, it, vi } from "vitest";
import { DESCRIPTOR_PATH, readOffers } from "./provider";

const answer = (status: number, body?: unknown) =>
  vi.fn(async () => new Response(body === undefined ? "" : JSON.stringify(body), { status }));

describe("readOffers", () => {
  it("asks the server's own descriptor, anonymously", async () => {
    const f = answer(200, { capabilities: {} });
    await readOffers("https://pod.example.org/", f);
    const [url, init] = f.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://pod.example.org" + DESCRIPTOR_PATH);
    expect(init.credentials).toBe("omit");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("is open when the descriptor lists register with a path", async () => {
    const f = answer(200, { capabilities: { account: { path: "/.account/" }, register: { path: "/.account/", podNames: "subdomain" } } });
    expect(await readOffers("https://pod.example.org/", f)).toBe("open");
  });

  it("is closed when the server answers and lists no register", async () => {
    const f = answer(200, { capabilities: { account: { path: "/.account/" } } });
    expect(await readOffers("https://pod.example.org/", f)).toBe("closed");
  });

  it("is closed for a register entry this app cannot use: another path, another layout, a protocol-relative path", async () => {
    for (const register of [{}, { path: 3 }, { path: "account/" }, null, { path: "/.account/" }, { path: "/.account/", podNames: "path" }, { path: "//evil.example/", podNames: "subdomain" }, { path: "/other/", podNames: "subdomain" }]) {
      const f = answer(200, { capabilities: { register } });
      expect(await readOffers("https://pod.example.org/", f)).toBe("closed");
    }
  });

  it("is closed on a server with no descriptor (stock CSS offers nothing beyond Solid)", async () => {
    expect(await readOffers("https://pod.example.org/", answer(404))).toBe("closed");
  });

  it("is down, not closed, when there is no answer to trust: the person may try again", async () => {
    expect(await readOffers("https://pod.example.org/", vi.fn(async () => { throw new TypeError("offline"); }))).toBe("down");
    expect(await readOffers("https://pod.example.org/", answer(502))).toBe("down");
    expect(await readOffers("https://pod.example.org/", answer(200, "not json at all"))).toBe("down");
    expect(await readOffers("https://pod.example.org/", answer(200, { software: "x" }))).toBe("down");
  });
});
