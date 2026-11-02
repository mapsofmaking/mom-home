import { describe, expect, it } from "vitest";
import { markPodMade, takePodMade } from "./handoff";

const made = { webId: "https://weld.pod.example/profile/card#me", pod: "https://weld.pod.example/" };

describe("the hand-off marker", () => {
  it("is read once, by the WebID it was written for", () => {
    markPodMade(made, sessionStorage);
    expect(takePodMade(made.webId, sessionStorage)).toEqual(made);
    expect(takePodMade(made.webId, sessionStorage)).toBeNull();
  });

  it("never speaks for another session, and is gone after the look", () => {
    markPodMade(made, sessionStorage);
    expect(takePodMade("https://someone.else/#me", sessionStorage)).toBeNull();
    expect(takePodMade(made.webId, sessionStorage)).toBeNull();
  });

  it("holds the WebID and the pod address, nothing else", () => {
    markPodMade({ ...made, email: "x@y.z", password: "secret" } as never, sessionStorage);
    const raw = sessionStorage.getItem("mom-home:pod-made")!;
    expect(JSON.parse(raw)).toEqual(made);
    sessionStorage.clear();
  });

  it("costs nothing when storage throws", () => {
    const broken = { setItem() { throw new Error("blocked"); }, getItem() { throw new Error("blocked"); }, removeItem() {} } as unknown as Storage;
    expect(() => markPodMade(made, broken)).not.toThrow();
    expect(takePodMade(made.webId, broken)).toBeNull();
  });

  it("ignores a damaged entry", () => {
    sessionStorage.setItem("mom-home:pod-made", "{not json");
    expect(takePodMade(made.webId, sessionStorage)).toBeNull();
  });
});
