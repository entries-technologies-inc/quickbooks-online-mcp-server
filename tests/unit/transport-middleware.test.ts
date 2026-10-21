import { jest } from "@jest/globals";
import {
  withRequestId,
  withRetry,
  type Transport,
} from "../../src/embed.js";
import type {
  QboCallContext,
  QboHttpRequest,
  QboHttpResponse,
  QboOperation,
} from "../../src/transport.js";

const context: QboCallContext = {
  realmId: "123",
  transport: async () => ({ status: 200, body: null }),
  app: undefined,
};

function request(
  op: QboOperation,
  query?: Record<string, string>,
  path = "/not-consulted",
): QboHttpRequest {
  const method =
    op.kind === "create" || op.kind === "update" || op.kind === "delete" || op.kind === "void"
      ? "POST"
      : "GET";

  return { op, method, path, query };
}

function sleepRecorder() {
  const waits: number[] = [];

  return {
    waits,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
}

describe("withRequestId", () => {
  it.each(["create", "update", "delete", "void"] as const)(
    "adds a request id on %s and ignores the path",
    async (kind) => {
      const seen: QboHttpRequest[] = [];
      const transport = withRequestId({ generate: () => `id-${kind}` })(
        async (incoming) => {
          seen.push(incoming);
          return { status: 200, body: null };
        },
      );
      const original = request(
        { kind, entity: "Bill" },
        { minorversion: "75" },
        "/reports/ProfitAndLoss",
      );

      await transport(original, context);

      expect(seen[0]?.query).toEqual({
        minorversion: "75",
        requestid: `id-${kind}`,
      });
      expect(seen[0]?.path).toBe("/reports/ProfitAndLoss");
      expect(original.query).toEqual({ minorversion: "75" });
      expect(seen[0]).not.toBe(original);
    },
  );

  it.each([
    { kind: "get", entity: "Bill" } as const,
    { kind: "query", entity: "Invoice" } as const,
    { kind: "report", report: "BalanceSheet" } as const,
  ])("leaves a $kind read untouched", async (op) => {
    const seen: QboHttpRequest[] = [];
    const transport = withRequestId({
      generate: () => {
        throw new Error("reads do not mint a request id");
      },
    })(async (incoming) => {
      seen.push(incoming);
      return { status: 200, body: null };
    });
    const original = request(op, { minorversion: "75" }, "/bill");

    await transport(original, context);

    expect(seen[0]).toBe(original);
    expect(seen[0]?.query).toEqual({ minorversion: "75" });
  });

  it("keeps a request id the caller already set", async () => {
    const seen: QboHttpRequest[] = [];
    const transport = withRequestId({
      generate: () => {
        throw new Error("existing request id must be kept");
      },
    })(async (incoming) => {
      seen.push(incoming);
      return { status: 200, body: null };
    });
    const original = request(
      { kind: "update", entity: "BillPayment" },
      { requestid: "from-tool", minorversion: "75" },
    );

    await transport(original, context);

    expect(seen[0]).toBe(original);
    expect(seen[0]?.query).toEqual({
      requestid: "from-tool",
      minorversion: "75",
    });
  });

  it("uses crypto.randomUUID when generate is omitted", async () => {
    const seen: QboHttpRequest[] = [];
    const transport = withRequestId()(async (incoming) => {
      seen.push(incoming);
      return { status: 200, body: null };
    });

    await transport(request({ kind: "create", entity: "Bill" }), context);

    expect(seen[0]?.query?.requestid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});

describe("withRetry", () => {
  function scripted(
    steps: Array<QboHttpResponse | Error>,
    seen: QboHttpRequest[] = [],
    seenContext: QboCallContext[] = [],
  ): Transport {
    let index = 0;

    return async (incoming, callContext) => {
      seen.push(incoming);
      seenContext.push(callContext);
      const step = steps[index++] ?? { status: 200, body: null };
      if (step instanceof Error) throw step;

      return step;
    };
  }

  it.each([429, 500, 502, 503, 504])(
    "retries a read on status %s",
    async (status) => {
      const { sleep, waits } = sleepRecorder();
      const seen: QboHttpRequest[] = [];
      const transport = withRetry({ sleep, maxAttempts: 3 })(
        scripted(
          [
            { status, body: { failed: true } },
            { status: 200, body: { ok: true } },
          ],
          seen,
        ),
      );

      await expect(
        transport(request({ kind: "get", entity: "Bill" }), context),
      ).resolves.toEqual({ status: 200, body: { ok: true } });
      expect(seen).toHaveLength(2);
      expect(waits).toHaveLength(1);
    },
  );

  it.each([200, 400, 404, 501, 505])(
    "does not retry a read on status %s",
    async (status) => {
      const { sleep, waits } = sleepRecorder();
      const transport = withRetry({ sleep })(
        scripted([{ status, body: { once: true } }]),
      );

      await expect(
        transport(request({ kind: "query", entity: "Bill" }), context),
      ).resolves.toEqual({ status, body: { once: true } });
      expect(waits).toEqual([]);
    },
  );

  it("stops at maxAttempts and returns the last response", async () => {
    const { sleep, waits } = sleepRecorder();
    let calls = 0;
    const transport = withRetry({ sleep, maxAttempts: 3 })(async () => {
      calls += 1;
      return { status: 500, body: { calls } };
    });

    await expect(
      transport(request({ kind: "report", report: "ProfitAndLoss" }), context),
    ).resolves.toEqual({ status: 500, body: { calls: 3 } });
    expect(calls).toBe(3);
    expect(waits).toHaveLength(2);
  });

  it("does not retry a write that has no request id", async () => {
    const { sleep, waits } = sleepRecorder();
    let calls = 0;
    const transport = withRetry({ sleep, maxAttempts: 3 })(async () => {
      calls += 1;
      return { status: 429, body: { calls } };
    });

    await expect(
      transport(request({ kind: "create", entity: "Bill" }), context),
    ).resolves.toEqual({ status: 429, body: { calls: 1 } });
    expect(calls).toBe(1);
    expect(waits).toEqual([]);
  });

  it("retries a write when requestid is present", async () => {
    const { sleep, waits } = sleepRecorder();
    const seen: QboHttpRequest[] = [];
    const transport = withRetry({ sleep, maxAttempts: 2 })(
      scripted(
        [
          { status: 503, body: null },
          { status: 200, body: { saved: true } },
        ],
        seen,
      ),
    );
    const original = request({ kind: "delete", entity: "Bill" }, {
      requestid: "stable",
    });

    await expect(transport(original, context)).resolves.toEqual({
      status: 200,
      body: { saved: true },
    });
    expect(seen.map((call) => call.query?.requestid)).toEqual([
      "stable",
      "stable",
    ]);
    expect(waits).toHaveLength(1);
  });

  it("retries thrown errors on reads and rethrows the last one", async () => {
    const { sleep, waits } = sleepRecorder();
    const first = new Error("reset");
    const last = new Error("timeout");
    let calls = 0;
    const transport = withRetry({ sleep, maxAttempts: 2 })(async () => {
      calls += 1;
      throw calls === 1 ? first : last;
    });

    await expect(
      transport(request({ kind: "get", entity: "Account" }), context),
    ).rejects.toBe(last);
    expect(calls).toBe(2);
    expect(waits).toHaveLength(1);
  });

  it("does not retry a thrown error on a write without requestid", async () => {
    const { sleep, waits } = sleepRecorder();
    const failure = new Error("socket hang up");
    let calls = 0;
    const transport = withRetry({ sleep, maxAttempts: 3 })(async () => {
      calls += 1;
      throw failure;
    });

    await expect(
      transport(request({ kind: "void", entity: "Invoice" }), context),
    ).rejects.toBe(failure);
    expect(calls).toBe(1);
    expect(waits).toEqual([]);
  });

  it("retries a thrown error on a write that has requestid", async () => {
    const { sleep } = sleepRecorder();
    const failure = new Error("socket hang up");
    let calls = 0;
    const transport = withRetry({ sleep, maxAttempts: 2 })(async () => {
      calls += 1;
      if (calls === 1) throw failure;
      return { status: 200, body: { retried: true } };
    });

    await expect(
      transport(
        request({ kind: "update", entity: "Bill" }, { requestid: "idem" }),
        context,
      ),
    ).resolves.toEqual({ status: 200, body: { retried: true } });
    expect(calls).toBe(2);
  });

  it("honours a Retry-After delay in seconds", async () => {
    const { sleep, waits } = sleepRecorder();
    jest.spyOn(Math, "random").mockReturnValue(0);
    const transport = withRetry({ sleep, baseDelayMs: 250 })(
      scripted([
        { status: 429, body: null, headers: { "Retry-After": "2" } },
        { status: 200, body: null },
      ]),
    );

    await transport(request({ kind: "get", entity: "Bill" }), context);

    expect(waits).toEqual([2000]);
  });

  it("honours a lowercase Retry-After HTTP date and caps it", async () => {
    const { sleep, waits } = sleepRecorder();
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const soon = new Date(1_700_000_000_000 + 2000).toUTCString();
    const later = new Date(1_700_000_000_000 + 30_000).toUTCString();
    const transport = withRetry({ sleep, maxAttempts: 3, maxDelayMs: 10_000 })(
      scripted([
        {
          status: 503,
          body: null,
          headers: { "x-request-id": "other", "retry-after": soon },
        },
        {
          status: 503,
          body: null,
          headers: { "Retry-After": later },
        },
        { status: 200, body: null },
      ]),
    );

    await transport(request({ kind: "query", entity: "Bill" }), context);

    expect(waits).toEqual([2000, 10_000]);
  });

  it("falls back to backoff when Retry-After is not a delay", async () => {
    const { sleep, waits } = sleepRecorder();
    jest.spyOn(Math, "random").mockReturnValue(0);
    const transport = withRetry({
      sleep,
      baseDelayMs: 250,
      maxDelayMs: 10_000,
    })(
      scripted([
        { status: 429, body: null, headers: { "Content-Type": "text/plain" } },
        { status: 429, body: null, headers: { "Retry-After": "soon" } },
        { status: 200, body: null },
      ]),
    );

    await transport(request({ kind: "get", entity: "Customer" }), context);

    expect(waits).toEqual([125, 250]);
  });

  it("caps exponential backoff", async () => {
    const { sleep, waits } = sleepRecorder();
    jest.spyOn(Math, "random").mockReturnValue(0);
    const transport = withRetry({
      sleep,
      maxAttempts: 3,
      baseDelayMs: 250,
      maxDelayMs: 300,
    })(
      scripted([
        { status: 500, body: null },
        { status: 500, body: null },
        { status: 200, body: null },
      ]),
    );

    await transport(request({ kind: "get", entity: "Vendor" }), context);

    expect(waits).toEqual([125, 150]);
  });

  it("jitters the backoff below the exponential step", async () => {
    const { sleep, waits } = sleepRecorder();
    const transport = withRetry({ sleep, baseDelayMs: 250, maxDelayMs: 10_000 })(
      scripted([
        { status: 502, body: null },
        { status: 200, body: null },
      ]),
    );

    await transport(request({ kind: "get", entity: "Item" }), context);

    expect(waits[0]).toBeGreaterThanOrEqual(125);
    expect(waits[0]).toBeLessThan(250);
  });

  it("uses a custom retryOn predicate", async () => {
    const { sleep, waits } = sleepRecorder();
    let calls = 0;
    const transport = withRetry({
      sleep,
      maxAttempts: 3,
      retryOn: (status) => status === 418,
    })(async () => {
      calls += 1;
      return { status: calls === 1 ? 418 : 500, body: null };
    });

    await expect(
      transport(request({ kind: "get", entity: "Term" }), context),
    ).resolves.toEqual({ status: 500, body: null });
    expect(calls).toBe(2);
    expect(waits).toHaveLength(1);
  });

  it("sleeps with the default timer", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    jest.useFakeTimers();
    try {
      let calls = 0;
      const transport = withRetry()(async () => {
        calls += 1;
        return { status: calls === 1 ? 504 : 200, body: "done" };
      });
      const pending = transport(
        request({ kind: "get", entity: "Class" }),
        context,
      );

      await jest.advanceTimersByTimeAsync(125);

      await expect(pending).resolves.toEqual({ status: 200, body: "done" });
      expect(calls).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("withRequestId around withRetry", () => {
  it("reuses one request id for every retry of a write", async () => {
    const { sleep, waits } = sleepRecorder();
    const seen: QboHttpRequest[] = [];
    const seenContext: QboCallContext[] = [];
    let calls = 0;
    const raw: Transport = async (incoming, callContext) => {
      seen.push(incoming);
      seenContext.push(callContext);
      calls += 1;
      if (calls < 3) {
        return {
          status: 503,
          body: null,
          headers: calls === 1 ? { "Retry-After": "0" } : undefined,
        };
      }

      return { status: 200, body: { id: "1" } };
    };
    const transport = withRequestId(
      withRetry({ sleep, maxAttempts: 3 })(raw),
    );

    await expect(
      transport(request({ kind: "create", entity: "Bill" }, { minorversion: "75" }), context),
    ).resolves.toEqual({ status: 200, body: { id: "1" } });

    const ids = seen.map((call) => call.query?.requestid);
    expect(ids[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(ids).toEqual([ids[0], ids[0], ids[0]]);
    expect(seen.every((call) => call.query?.minorversion === "75")).toBe(true);
    expect(seenContext.every((call) => call === context)).toBe(true);
    expect(waits).toEqual([0, expect.any(Number)]);
  });

  it("does not retry a write when the request id is added inside retry", async () => {
    const { sleep, waits } = sleepRecorder();
    const seen: QboHttpRequest[] = [];
    let generated = 0;
    const raw: Transport = async (incoming) => {
      seen.push(incoming);
      return { status: 500, body: null };
    };
    const transport = withRetry({ sleep, maxAttempts: 3 })(
      withRequestId({
        generate: () => {
          generated += 1;
          return `fresh-${generated}`;
        },
      })(raw),
    );

    await expect(
      transport(request({ kind: "update", entity: "Vendor" }), context),
    ).resolves.toEqual({ status: 500, body: null });

    expect(generated).toBe(1);
    expect(seen.map((call) => call.query?.requestid)).toEqual(["fresh-1"]);
    expect(waits).toEqual([]);
  });

  it("does not retry a read's missing request id and does not add one", async () => {
    const { sleep, waits } = sleepRecorder();
    const seen: QboHttpRequest[] = [];
    let calls = 0;
    const raw: Transport = async (incoming) => {
      seen.push(incoming);
      calls += 1;
      return { status: calls === 1 ? 429 : 200, body: null };
    };
    const transport = withRequestId({
      generate: () => {
        throw new Error("reads do not mint a request id");
      },
    })(withRetry({ sleep, maxAttempts: 2 })(raw));

    await transport(
      request({ kind: "report", report: "BalanceSheet" }),
      context,
    );

    expect(calls).toBe(2);
    expect(seen.every((call) => call.query?.requestid === undefined)).toBe(
      true,
    );
    expect(waits).toHaveLength(1);
  });
});
