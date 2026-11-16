// Waking the match server from the menus (src/game/wake.ts): when a knock goes
// out, when it is skipped, and that nothing about it can get in a player's way.
// No server is needed: the knock's fetch is a stub that records what was sent.
//
// Excluded from this package's `tsc` (it imports frontend code).
import assert from "assert";
import { healthUrl, resetWakeForTests, WAKE_REPEAT_MS, wakeMatchServer, type WakeDeps } from "../../src/game/wake.js";

const URL = "https://match.example";

type Sent = { input: string; init: RequestInit };

/** A fetch that records each call and settles as the test says. */
function recorder(settle: "resolve" | "reject" | "hang" | "throw" = "resolve") {
  const sent: Sent[] = [];
  const fetch = (input: string, init: RequestInit): Promise<unknown> => {
    sent.push({ input, init });
    if (settle === "throw") throw new TypeError("fetch is not allowed here");
    if (settle === "reject") return Promise.reject(new TypeError("Failed to fetch"));
    if (settle === "hang") return new Promise(() => {});
    return Promise.resolve({ ok: true });
  };
  return { sent, fetch };
}

/** Settle any rejection handlers the knock attached. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("waking the match server from the menus", () => {
  let clock = 1_000_000;
  const deps = (extra: Partial<WakeDeps> = {}): WakeDeps => ({ url: URL, transport: "colyseus", now: () => clock, ...extra });

  beforeEach(() => {
    resetWakeForTests();
    clock = 1_000_000;
  });

  it("knocks once on the public /health probe, fire-and-forget", () => {
    const r = recorder();
    assert.strictEqual(wakeMatchServer(deps({ fetch: r.fetch })), true);
    assert.deepStrictEqual(r.sent, [{ input: `${URL}/health`, init: { mode: "no-cors", cache: "no-store" } }]);
  });

  it("asks over HTTP(S) whatever scheme the server URL uses", () => {
    assert.strictEqual(healthUrl("wss://match.example"), "https://match.example/health");
    assert.strictEqual(healthUrl("ws://localhost:2567/"), "http://localhost:2567/health");
    assert.strictEqual(healthUrl("http://localhost:2567"), "http://localhost:2567/health");
  });

  it("sends nothing in a PeerJS build or without a server URL", () => {
    const r = recorder();
    assert.strictEqual(wakeMatchServer(deps({ transport: "peerjs", fetch: r.fetch })), false);
    assert.strictEqual(wakeMatchServer(deps({ url: null, fetch: r.fetch })), false);
    assert.strictEqual(wakeMatchServer(deps({ url: "", fetch: r.fetch })), false);
    assert.strictEqual(r.sent.length, 0);
  });

  it("skips repeat knocks within WAKE_REPEAT_MS: PLAY WITH FRIENDS → setup → lobby costs one request", () => {
    const r = recorder("hang"); // a sleeping server: the first knock is still waiting
    assert.strictEqual(wakeMatchServer(deps({ fetch: r.fetch })), true); // PLAY WITH FRIENDS on the title screen
    clock += 50;
    assert.strictEqual(wakeMatchServer(deps({ fetch: r.fetch })), false); // setup opens in friends mode
    clock += 6_950;
    assert.strictEqual(wakeMatchServer(deps({ fetch: r.fetch })), false); // switched solo → friends and back
    clock += WAKE_REPEAT_MS - 7_001;
    assert.strictEqual(wakeMatchServer(deps({ fetch: r.fetch })), false); // lobby, just inside the window
    assert.strictEqual(r.sent.length, 1);
  });

  it("knocks again once the window has passed (a player who lingered on a menu)", () => {
    const r = recorder();
    assert.strictEqual(wakeMatchServer(deps({ fetch: r.fetch })), true);
    clock += WAKE_REPEAT_MS;
    assert.strictEqual(wakeMatchServer(deps({ fetch: r.fetch })), true);
    clock += 15 * 60_000;
    assert.strictEqual(wakeMatchServer(deps({ fetch: r.fetch })), true);
    assert.strictEqual(r.sent.length, 3);
  });

  it("a failed knock never throws and does not hold back the next one", async () => {
    const failing = recorder("reject");
    assert.strictEqual(wakeMatchServer(deps({ fetch: failing.fetch })), true);
    await flush(); // the rejection is swallowed, and the knock forgotten
    const next = recorder();
    assert.strictEqual(wakeMatchServer(deps({ fetch: next.fetch })), true);
    assert.strictEqual(next.sent.length, 1);
  });

  it("a fetch that throws at once is contained, and the next trigger may try again", () => {
    const throwing = recorder("throw");
    assert.doesNotThrow(() => assert.strictEqual(wakeMatchServer(deps({ fetch: throwing.fetch })), false));
    const next = recorder();
    assert.strictEqual(wakeMatchServer(deps({ fetch: next.fetch })), true);
  });

  it("a broken clock is contained too: waking is never allowed to get in the way", () => {
    const r = recorder();
    const now = () => {
      throw new Error("no clock");
    };
    assert.doesNotThrow(() => assert.strictEqual(wakeMatchServer(deps({ fetch: r.fetch, now })), false));
    assert.strictEqual(r.sent.length, 0);
  });

  it("a knock that never answers does not block: the call returns at once", () => {
    const r = recorder("hang");
    const started = Date.now();
    assert.strictEqual(wakeMatchServer(deps({ fetch: r.fetch })), true);
    assert.ok(Date.now() - started < 50, "wakeMatchServer waited on the request");
  });
});
