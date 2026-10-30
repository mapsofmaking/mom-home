import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.mock("./auth", () => ({ authFetch: (...args: unknown[]) => mockFetch(...args) }));

const { readTurtle, forgetReads } = await import("./read");

const URL_A = "https://pod.example/hs/config.ttl";
const ok = (body: string, etag: string | null = '"v1"') =>
  new Response(body, { status: 200, headers: etag ? { ETag: etag, "Content-Type": "text/turtle" } : {} });
const notModified = () => new Response(null, { status: 304 });
const sent = (call: number) => (mockFetch.mock.calls[call][1] as RequestInit).headers as Record<string, string>;

beforeEach(() => {
  mockFetch.mockReset();
  forgetReads();
});

describe("readTurtle — revalidated, never served without asking", () => {
  it("asks with the kept ETag and hands back the kept body on 304", async () => {
    mockFetch.mockResolvedValueOnce(ok("<#a> <#b> <#c>.")).mockResolvedValueOnce(notModified());
    await readTurtle(URL_A);
    const again = await readTurtle(URL_A);

    expect(sent(0)["If-None-Match"]).toBeUndefined();
    expect(sent(1)["If-None-Match"]).toBe('"v1"');
    expect(again.status).toBe(200);
    expect(again.headers.get("etag")).toBe('"v1"');
    expect(await again.text()).toBe("<#a> <#b> <#c>.");
  });

  it("takes the new body and ETag when the document changed", async () => {
    mockFetch
      .mockResolvedValueOnce(ok("old", '"v1"'))
      .mockResolvedValueOnce(ok("new", '"v2"'))
      .mockResolvedValueOnce(notModified());
    await readTurtle(URL_A);
    expect(await (await readTurtle(URL_A)).text()).toBe("new");
    expect(await (await readTurtle(URL_A)).text()).toBe("new");
    expect(sent(2)["If-None-Match"]).toBe('"v2"');
  });

  it("forgets a document that is gone or refused, and asks plainly next time", async () => {
    mockFetch
      .mockResolvedValueOnce(ok("x"))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(ok("y"));
    await readTurtle(URL_A);
    expect((await readTurtle(URL_A)).status).toBe(403);
    await readTurtle(URL_A);
    expect(sent(2)["If-None-Match"]).toBeUndefined();
  });

  it("keeps nothing without an ETag, and nothing after sign-out", async () => {
    mockFetch.mockResolvedValueOnce(ok("x", null)).mockResolvedValueOnce(ok("x")).mockResolvedValueOnce(ok("x"));
    await readTurtle(URL_A);
    await readTurtle(URL_A);
    expect(sent(1)["If-None-Match"]).toBeUndefined();
    forgetReads();
    await readTurtle(URL_A);
    expect(sent(2)["If-None-Match"]).toBeUndefined();
  });

  it("asks again without If-None-Match when a provider refuses the header", async () => {
    mockFetch
      .mockResolvedValueOnce(ok("x"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(ok("x"));
    await readTurtle(URL_A);
    expect(await (await readTurtle(URL_A)).text()).toBe("x");
    expect(sent(2)["If-None-Match"]).toBeUndefined();
  });

  it("never lets the browser answer from its own cache", async () => {
    mockFetch.mockResolvedValueOnce(ok("x"));
    await readTurtle(URL_A);
    expect((mockFetch.mock.calls[0][1] as RequestInit).cache).toBe("no-store");
  });
});
