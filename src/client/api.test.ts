/**
 * Unit tests for src/client/api.ts
 *
 * Covers:
 *  - The post() wrapper: success path, HTTP-error throwing ApiError, JSON parse
 *  - Each endpoint function on api.*: request shape + error handling
 *
 * fetch is stubbed via vi.stubGlobal so no real network is involved.
 * Vitest globals are enabled (describe/it/expect/vi are global).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, ApiError } from "./api.js";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Build a fake Response whose .ok, .status, .statusText, .json() and .text() are
 *  all controllable. */
function fakeResponse(opts: {
  ok: boolean;
  status: number;
  statusText?: string;
  body?: unknown; // used for .json()
  text?: string; // used for .text() on error path
}): Response {
  return {
    ok: opts.ok,
    status: opts.status,
    statusText: opts.statusText ?? (opts.ok ? "OK" : "Error"),
    json: vi.fn().mockResolvedValue(opts.body ?? {}),
    text: vi.fn().mockResolvedValue(opts.text ?? opts.statusText ?? ""),
  } as unknown as Response;
}

/** Return the parsed JSON body that was passed to the (single) fetch call. */
function capturedBody(): unknown {
  const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
  const call = fetchMock.mock.calls[0];
  if (!call) throw new Error("fetch was not called");
  const init = call[1] as RequestInit;
  return JSON.parse(init.body as string);
}

/** Return the URL that was passed to the (single) fetch call. */
function capturedUrl(): string {
  const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
  const call = fetchMock.mock.calls[0];
  if (!call) throw new Error("fetch was not called");
  return call[0] as string;
}

// ── stub setup / teardown ────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── post() wrapper — success path ────────────────────────────────────────────

describe("post() wrapper — success path", () => {
  it("calls fetch with the correct URL, method, Content-Type header, and JSON body", async () => {
    const payload = { dailySeed: "2026-06-28" };
    const responseData = { view: {} };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: true, status: 200, body: responseData }),
    );

    await api.startCase(payload);

    expect(capturedUrl()).toBe("/api/startCase");

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(capturedBody()).toEqual(payload);
  });

  it("returns the parsed JSON from the response", async () => {
    const responseData = { view: { caseId: "c1", dailySeed: "2026-06-28", setting: "The Parlor", victim: "V", map: {}, suspectIds: [], npcs: [], items: [] } };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: true, status: 200, body: responseData }),
    );

    const result = await api.startCase({ dailySeed: "2026-06-28" });
    expect(result).toEqual(responseData);
  });
});

// ── post() wrapper — HTTP error path (ApiError) ───────────────────────────────

describe("post() wrapper — HTTP error throwing ApiError", () => {
  it("throws ApiError with the correct endpoint, status, and detail from res.text()", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: false, status: 500, statusText: "Internal Server Error", text: "DB timeout" }),
    );

    await expect(api.startCase({ dailySeed: "2026-06-28" })).rejects.toThrow(ApiError);

    try {
      await api.startCase({ dailySeed: "2026-06-28" });
    } catch (err) {
      const e = err as ApiError;
      expect(e).toBeInstanceOf(ApiError);
      expect(e.name).toBe("ApiError");
      expect(e.endpoint).toBe("startCase");
      expect(e.status).toBe(500);
      expect(e.message).toContain("POST /api/startCase failed (500)");
      expect(e.message).toContain("DB timeout");
    }
  });

  it("throws ApiError with statusText when res.text() itself throws", async () => {
    const errorResponse = {
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: vi.fn().mockRejectedValue(new Error("no body")),
      text: vi.fn().mockRejectedValue(new Error("network glitch")),
    } as unknown as Response;

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(errorResponse);

    try {
      await api.startCase({ dailySeed: "2026-06-28" });
    } catch (err) {
      const e = err as ApiError;
      expect(e).toBeInstanceOf(ApiError);
      expect(e.status).toBe(503);
      // falls back to statusText
      expect(e.message).toContain("Service Unavailable");
    }
  });

  it("throws ApiError on 404", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: false, status: 404, statusText: "Not Found", text: "not found" }),
    );

    await expect(api.interrogate({ caseId: "c1", dailySeed: "2026-06-28", npcId: "npc_a", message: "Where were you?" }))
      .rejects.toThrow(ApiError);
  });
});

// ── JSON parse: response body is forwarded as-is ─────────────────────────────

describe("post() wrapper — JSON parse", () => {
  it("forwards the exact deserialized JSON body", async () => {
    const body = { reply: "I was in the garden.", revealed: [], moderated: false };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: true, status: 200, body }),
    );

    const result = await api.interrogate({ caseId: "c1", dailySeed: "2026-06-28", npcId: "npc_a", message: "?" });
    expect(result).toEqual(body);
  });
});

// ── api.startCase ─────────────────────────────────────────────────────────────

describe("api.startCase", () => {
  it("posts to /api/startCase with the dailySeed", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: true, status: 200, body: { view: {} } }),
    );

    await api.startCase({ dailySeed: "2026-06-28" });

    expect(capturedUrl()).toBe("/api/startCase");
    expect(capturedBody()).toEqual({ dailySeed: "2026-06-28" });
  });
});

// ── api.interrogate ───────────────────────────────────────────────────────────

describe("api.interrogate", () => {
  const req = { caseId: "c1", dailySeed: "2026-06-28", npcId: "npc_butler", message: "Where were you?" };

  it("posts to /api/interrogate with the full request shape", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: true, status: 200, body: { reply: "In the pantry.", revealed: [] } }),
    );

    await api.interrogate(req);

    expect(capturedUrl()).toBe("/api/interrogate");
    expect(capturedBody()).toEqual(req);
  });

  it("throws ApiError on HTTP error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: false, status: 422, text: "Moderation block" }),
    );

    await expect(api.interrogate(req)).rejects.toThrow(ApiError);
  });
});

// ── api.examine ───────────────────────────────────────────────────────────────

describe("api.examine", () => {
  const req = { caseId: "c1", dailySeed: "2026-06-28", itemId: "item_candlestick" };

  it("posts to /api/examine with the full request shape", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: true, status: 200, body: { examineText: "Heavy brass.", revealed: [] } }),
    );

    await api.examine(req);

    expect(capturedUrl()).toBe("/api/examine");
    expect(capturedBody()).toEqual(req);
  });

  it("throws ApiError on HTTP error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: false, status: 500, text: "Internal error" }),
    );

    await expect(api.examine(req)).rejects.toThrow(ApiError);
  });
});

// ── api.nominate ──────────────────────────────────────────────────────────────

describe("api.nominate", () => {
  const req = { caseId: "c1", npcId: "npc_butler", role: "suspect" as const };

  it("posts to /api/nominate with the full request shape", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: true, status: 200, body: { ok: true } }),
    );

    const result = await api.nominate(req);

    expect(capturedUrl()).toBe("/api/nominate");
    expect(capturedBody()).toEqual(req);
    expect(result).toEqual({ ok: true });
  });

  it("throws ApiError on HTTP error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: false, status: 400, text: "Bad request" }),
    );

    await expect(api.nominate(req)).rejects.toThrow(ApiError);
  });
});

// ── api.accuse ────────────────────────────────────────────────────────────────

describe("api.accuse", () => {
  const req = {
    caseId: "c1",
    dailySeed: "2026-06-28",
    nominatedKillerId: "npc_butler",
    nominations: { npc_butler: "killer" as const, npc_maid: "bystander" as const },
    discoveredClueIds: ["clue_1", "clue_2"],
    inventory: ["item_candlestick"],
    questions: 5,
    timeMs: 300000,
  };

  const successBody = {
    solved: true,
    score: 850,
    rank: 3,
    streak: { count: 2, freeze: 0 },
    summary: { killerName: "The Butler", yourClueCount: 2, crowd: { total: 42, killerRightPct: 0.55 } },
  };

  it("posts to /api/accuse with the full request shape", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: true, status: 200, body: successBody }),
    );

    const result = await api.accuse(req);

    expect(capturedUrl()).toBe("/api/accuse");
    expect(capturedBody()).toEqual(req);
    expect(result).toEqual(successBody);
  });

  it("throws ApiError on HTTP error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: false, status: 403, text: "Forbidden" }),
    );

    await expect(api.accuse(req)).rejects.toThrow(ApiError);
  });
});

// ── api.present ───────────────────────────────────────────────────────────────

describe("api.present", () => {
  const req = { caseId: "c1", dailySeed: "2026-06-28", itemId: "item_ring", npcId: "npc_maid", tick: 12 };

  it("posts to /api/present with the full request shape including tick", async () => {
    const body = { reactionText: "She paled.", revealed: [], caughtInLie: true };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: true, status: 200, body }),
    );

    const result = await api.present(req);

    expect(capturedUrl()).toBe("/api/present");
    expect(capturedBody()).toEqual(req);
    expect(result).toEqual(body);
  });

  it("tick is optional — posts without it", async () => {
    const reqNoTick = { caseId: "c1", dailySeed: "2026-06-28", itemId: "item_ring", npcId: "npc_maid" };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: true, status: 200, body: { reactionText: "Hmm.", revealed: [], caughtInLie: false } }),
    );

    await api.present(reqNoTick);

    expect(capturedBody()).toEqual(reqNoTick);
  });

  it("throws ApiError on HTTP error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: false, status: 500, text: "Server error" }),
    );

    await expect(api.present(req)).rejects.toThrow(ApiError);
  });
});

// ── api.move ──────────────────────────────────────────────────────────────────

describe("api.move", () => {
  const req = { caseId: "c1", dailySeed: "2026-06-28", zoneId: "library", tick: 7 };

  it("posts to /api/move with the full request shape", async () => {
    const body = { zoneId: "library", witnessedBy: ["npc_scholar"] };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: true, status: 200, body }),
    );

    const result = await api.move(req);

    expect(capturedUrl()).toBe("/api/move");
    expect(capturedBody()).toEqual(req);
    expect(result).toEqual(body);
  });

  it("throws ApiError on HTTP error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: false, status: 500, text: "Server error" }),
    );

    await expect(api.move(req)).rejects.toThrow(ApiError);
  });
});

// ── api.saveState ─────────────────────────────────────────────────────────────

describe("api.saveState", () => {
  const req = {
    dailySeed: "2026-06-28",
    dayId: "day-42",
    posZone: "parlor",
    boardGraph: { nodes: [], edges: [] },
    inventory: ["item_ring"],
    transcriptRef: "tx_abc123",
    questionsUsed: 3,
    elapsedMs: 120000,
    facultyXp: { logic: 10, empathy: 5 },
  };

  it("posts to /api/saveState with the full request shape", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: true, status: 200, body: { ok: true } }),
    );

    const result = await api.saveState(req);

    expect(capturedUrl()).toBe("/api/saveState");
    expect(capturedBody()).toEqual(req);
    expect(result).toEqual({ ok: true });
  });

  it("facultyXp is optional — posts without it", async () => {
    const { facultyXp: _, ...reqNoXp } = req;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: true, status: 200, body: { ok: true } }),
    );

    await api.saveState(reqNoXp);

    expect(capturedBody()).toEqual(reqNoXp);
  });

  it("throws ApiError on HTTP error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: false, status: 503, text: "Unavailable" }),
    );

    await expect(api.saveState(req)).rejects.toThrow(ApiError);
  });
});

// ── api.resume ────────────────────────────────────────────────────────────────

describe("api.resume", () => {
  const req = { dailySeed: "2026-06-28", dayId: "day-42" };

  it("posts to /api/resume with the full request shape", async () => {
    const body = {
      state: {
        posZone: "parlor",
        boardGraph: {},
        inventory: [],
        transcriptRef: "tx_abc",
        questionsUsed: 2,
        elapsedMs: 60000,
        facultyXp: {},
      },
      readOnly: false,
      startFresh: false,
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: true, status: 200, body }),
    );

    const result = await api.resume(req);

    expect(capturedUrl()).toBe("/api/resume");
    expect(capturedBody()).toEqual(req);
    expect(result).toEqual(body);
  });

  it("handles null state (start fresh)", async () => {
    const body = { state: null, readOnly: false, startFresh: true };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: true, status: 200, body }),
    );

    const result = await api.resume(req);
    expect(result.state).toBeNull();
    expect(result.startFresh).toBe(true);
  });

  it("throws ApiError on HTTP error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: false, status: 404, text: "No session" }),
    );

    await expect(api.resume(req)).rejects.toThrow(ApiError);
  });
});

// ── api.detective ─────────────────────────────────────────────────────────────

describe("api.detective", () => {
  const req = {};

  it("posts to /api/detective with an empty request body", async () => {
    const body = {
      detective: {
        faculties: { logic: 3, empathy: 2, drama: 1, perception: 1, authority: 0, encyclopedia: 0 },
        xp: 120,
        playStreak: 4,
        solveStreak: 2,
        unlocks: ["pressure"],
      },
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: true, status: 200, body }),
    );

    const result = await api.detective(req);

    expect(capturedUrl()).toBe("/api/detective");
    expect(capturedBody()).toEqual(req);
    expect(result).toEqual(body);
  });

  it("throws ApiError on HTTP error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeResponse({ ok: false, status: 401, text: "Unauthorized" }),
    );

    await expect(api.detective(req)).rejects.toThrow(ApiError);
  });
});

// ── ApiError class invariants ─────────────────────────────────────────────────

describe("ApiError class", () => {
  it("has correct name, endpoint, status, and message format", () => {
    const err = new ApiError("testEndpoint", 418, "I'm a teapot");
    expect(err.name).toBe("ApiError");
    expect(err.endpoint).toBe("testEndpoint");
    expect(err.status).toBe(418);
    expect(err.message).toBe("POST /api/testEndpoint failed (418): I'm a teapot");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
  });
});
