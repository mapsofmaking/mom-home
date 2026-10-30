import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.mock("./auth", () => ({ authFetch: (...args: unknown[]) => mockFetch(...args) }));

const { readWithEtag, writeIfMatch, updateDocument } = await import("./conditional");
import type { ConditionalError } from "./conditional";

/** A GET response carrying a body and an ETag. */
function readResponse(text: string, etag: string | null = '"v1"'): Response {
  return {
    ok: true,
    status: 200,
    text: async () => text,
    headers: { get: (name: string) => (name.toLowerCase() === "etag" ? etag : null) },
  } as unknown as Response;
}

function writeResponse(status = 205): Response {
  return { ok: status < 400, status } as unknown as Response;
}

/** The init object of the Nth call, for asserting headers. */
function initOf(call: number): RequestInit {
  return mockFetch.mock.calls[call][1] as RequestInit;
}

/** Awaits a promise that must reject, and hands back the error to assert on. */
async function rejection(promise: Promise<unknown>): Promise<ConditionalError> {
  try {
    await promise;
  } catch (err) {
    return err as ConditionalError;
  }
  throw new Error("Expected the operation to reject, but it resolved.");
}

beforeEach(() => mockFetch.mockReset());

describe("readWithEtag", () => {
  it("returns the body and the ETag, and bypasses the browser cache", async () => {
    mockFetch.mockResolvedValue(readResponse("hello", '"abc"'));

    const snapshot = await readWithEtag("https://pod.example/doc.ttl");

    expect(snapshot).toEqual({ text: "hello", etag: '"abc"' });
    // A cached response would carry a stale ETag, making If-Match meaningless.
    expect(initOf(0).cache).toBe("no-store");
  });

  it("reports a failed read with its status", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 } as Response);

    await expect(readWithEtag("https://pod.example/gone.ttl")).rejects.toMatchObject({
      code: "read-failed",
      status: 404,
    });
  });
});

describe("writeIfMatch", () => {
  it("sends If-Match when an ETag is known", async () => {
    mockFetch.mockResolvedValue(writeResponse());

    await writeIfMatch("https://pod.example/doc.ttl", "body", '"abc"');

    const init = initOf(0);
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["If-Match"]).toBe('"abc"');
  });

  it("omits If-Match when there is no ETag — an unconditional create", async () => {
    mockFetch.mockResolvedValue(writeResponse(201));

    await writeIfMatch("https://pod.example/new.ttl", "body", null);

    expect((initOf(0).headers as Record<string, string>)["If-Match"]).toBeUndefined();
  });

  it("defaults to Turtle but honours an explicit content type", async () => {
    mockFetch.mockResolvedValue(writeResponse());

    await writeIfMatch("https://pod.example/a.ttl", "b", null);
    expect((initOf(0).headers as Record<string, string>)["Content-Type"]).toBe(
      "text/turtle"
    );

    await writeIfMatch("https://pod.example/b.toml", "b", null, "text/plain");
    expect((initOf(1).headers as Record<string, string>)["Content-Type"]).toBe(
      "text/plain"
    );
  });
});

describe("updateDocument", () => {
  it("reads, transforms and writes with the ETag from that read", async () => {
    mockFetch
      .mockResolvedValueOnce(readResponse("a = 1", '"v1"'))
      .mockResolvedValueOnce(writeResponse());

    await updateDocument("https://pod.example/doc.ttl", (text) => text + "\nb = 2");

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const write = initOf(1);
    expect(write.body).toBe("a = 1\nb = 2");
    expect((write.headers as Record<string, string>)["If-Match"]).toBe('"v1"');
  });

  it("retries ONCE on 412, re-applying against the newer text", async () => {
    // The whole point: a concurrent writer landed between our read and write.
    // The retry must see *their* version, not a cached copy of ours.
    const seenByTransform: string[] = [];

    mockFetch
      .mockResolvedValueOnce(readResponse("original", '"v1"'))
      .mockResolvedValueOnce(writeResponse(412))
      .mockResolvedValueOnce(readResponse("changed by someone else", '"v2"'))
      .mockResolvedValueOnce(writeResponse());

    await updateDocument("https://pod.example/doc.ttl", (text) => {
      seenByTransform.push(text);
      return text + " + mine";
    });

    expect(seenByTransform).toEqual(["original", "changed by someone else"]);

    const secondWrite = initOf(3);
    expect(secondWrite.body).toBe("changed by someone else + mine");
    expect((secondWrite.headers as Record<string, string>)["If-Match"]).toBe('"v2"');
  });

  it("gives up after a SECOND 412 instead of looping", async () => {
    mockFetch
      .mockResolvedValueOnce(readResponse("a", '"v1"'))
      .mockResolvedValueOnce(writeResponse(412))
      .mockResolvedValueOnce(readResponse("b", '"v2"'))
      .mockResolvedValueOnce(writeResponse(412));

    const err = await rejection(
      updateDocument("https://pod.example/doc.ttl", (t) => t + "!")
    );

    expect(err.code).toBe("conflict");
    expect(err.status).toBe(412);
    // Two reads and two writes, then stop. Never a third attempt.
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("never resolves successfully without having written", async () => {
    // The failure mode this file exists to prevent: a caller told the write
    // succeeded when nothing was written. Whatever else updateDocument does on
    // repeated conflict, resolving is not allowed.
    mockFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? writeResponse(412) : readResponse("a", '"v"')
    );

    await expect(
      updateDocument("https://pod.example/doc.ttl", (t) => t + "!")
    ).rejects.toBeDefined();
  });

  it("aborts without writing when the transform returns null", async () => {
    mockFetch.mockResolvedValueOnce(readResponse("a", '"v1"'));

    const err = await rejection(updateDocument("https://pod.example/doc.ttl", () => null));

    expect(err.code).toBe("not-found");
    // One call — the read. Nothing was written.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("propagates a non-412 write failure without retrying", async () => {
    mockFetch
      .mockResolvedValueOnce(readResponse("a", '"v1"'))
      .mockResolvedValueOnce(writeResponse(403));

    const err = await rejection(
      updateDocument("https://pod.example/doc.ttl", (t) => t + "!")
    );

    expect(err.status).toBe(403);
    expect(err.code).toBe("write-failed");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
