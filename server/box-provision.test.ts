// Box creation against a stub provider. The thing worth pinning is the
// free-trial fallback: a trial account rejects the 8h auto-stop outright,
// so without a retry at its ceiling the Computer panel can never
// provision a box at all. The retry must stay narrow — one specific
// refusal code — and whatever the provider says the second time is what
// the user must be told.
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AppConfig } from "./config.ts";

type StubResponse = { status: number; body: unknown };

let provisionBox: typeof import("./box.ts").provisionBox;
let stub: Server;
/** answers for POST /boxes, in order; the last one repeats */
let createResponses: StubResponse[] = [];
let createBodies: any[] = [];

const created = (id: string) => ({ status: 200, body: { ok: true, box: { id, state: "idle" } } });
const cfg = { box: { token: "box_good" } } as AppConfig;

// a fresh bot id per test: box.ts caches the resolved id per bot
let seq = 0;
const nextBotId = () => `bot-${++seq}-${"x".repeat(8)}`;

beforeAll(async () => {
  stub = createServer((req, res) => {
    const url = req.url ?? "";
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "POST" && url === "/boxes") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        createBodies.push(JSON.parse(raw || "{}"));
        const next = createResponses.length > 1 ? createResponses.shift()! : createResponses[0];
        reply(next.status, next.body);
      });
      return;
    }
    if (url === "/boxes") return reply(200, { ok: true, boxes: [] }); // findBox: nothing yet
    if (url.includes("/commands")) return reply(200, { ok: true, exitCode: 0, stdout: "bootstrapped", stderr: "" });
    if (url.includes("/desktop")) return reply(200, { ok: true, desktopUrl: "https://stub.invalid/desktop" });
    return reply(200, { ok: true, box: { id: url.split("/")[2], state: "idle" } }); // GET/PATCH one box
  });
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
  process.env.OMB_BOX_API = `http://127.0.0.1:${(stub.address() as { port: number }).port}`;
  ({ provisionBox } = await import("./box.ts")); // reads OMB_BOX_API at load
});

afterAll(() => {
  stub?.close();
  delete process.env.OMB_BOX_API;
});

beforeEach(() => {
  createResponses = [];
  createBodies = [];
});

const TRIAL_REFUSAL = {
  status: 400,
  body: {
    ok: false,
    code: "trial_auto_stop_required",
    message: "Free-trial Boxes can auto-stop after at most 2 hours. Choose 2 hours or less.",
  },
};

describe("provisionBox create", () => {
  it("asks for an 8h auto-stop and takes it when the provider allows", async () => {
    createResponses = [created("box-8h")];
    const out = await provisionBox(cfg, nextBotId(), "Ada");
    expect(out.boxId).toBe("box-8h");
    expect(createBodies).toEqual([{ ttlSeconds: 8 * 60 * 60 }]);
  });

  it("retries once at the 2h ceiling when a free trial refuses the 8h stop", async () => {
    createResponses = [TRIAL_REFUSAL, created("box-trial")];
    const out = await provisionBox(cfg, nextBotId(), "Ada");
    expect(out.boxId).toBe("box-trial");
    expect(createBodies).toEqual([{ ttlSeconds: 8 * 60 * 60 }, { ttlSeconds: 2 * 60 * 60 }]);
  });

  it("does not retry other refusals — a billing wall is not a TTL problem", async () => {
    createResponses = [
      {
        status: 402,
        body: { ok: false, code: "billing_required", message: "Start the $20/month Box plan to create sandboxes." },
      },
      created("never-reached"),
    ];
    await expect(provisionBox(cfg, nextBotId(), "Ada")).rejects.toThrow(/\$20\/month Box plan/);
    expect(createBodies).toHaveLength(1);
  });

  it("surfaces the retry's own answer when the second create fails too", async () => {
    createResponses = [
      TRIAL_REFUSAL,
      { status: 402, body: { ok: false, code: "billing_required", message: "Trial boxes are exhausted." } },
    ];
    await expect(provisionBox(cfg, nextBotId(), "Ada")).rejects.toThrow("Trial boxes are exhausted.");
    expect(createBodies).toHaveLength(2);
  });
});
