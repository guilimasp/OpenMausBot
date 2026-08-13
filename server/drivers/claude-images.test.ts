// Attached images reach the claude CLI as Messages-API image blocks, and a
// turn without them keeps the plain-string prompt. Same scripted fake CLI
// as claude.test.ts.
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureDirs } from "../config.ts";
import type { ProviderInstance } from "../contracts.ts";
import { recordEvents, type EventRecorder } from "../testing/events.ts";
import { ClaudeDriver } from "./claude.ts";

const FAKE_CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "testing", "fake-claude-cli.ts");
// spawning a shebang script — POSIX-only until Windows CLI spawning lands
const posixOnly = describe.skipIf(process.platform === "win32");

posixOnly("ClaudeDriver image attachments (fake CLI)", () => {
  let instance: ProviderInstance;
  let recorder: EventRecorder;
  let scratch: string;

  beforeEach(async () => {
    ensureDirs();
    chmodSync(FAKE_CLI, 0o755);
    scratch = mkdtempSync(join(tmpdir(), "omb-claude-img-test-"));
    instance = await ClaudeDriver.create({
      instanceId: "claude-img-test",
      displayName: "Claude Image Test",
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, permissionMode: "acceptEdits" },
    });
    recorder = recordEvents(instance.adapter);
  });

  afterEach(async () => {
    delete process.env.FAKE_CLAUDE_DUMP;
    recorder?.stop();
    await instance?.dispose();
    rmSync(scratch, { recursive: true, force: true });
  });

  const promptSentFor = async (turn: { threadId: string; text: string; images?: any[] }) => {
    const dump = join(scratch, `${turn.threadId}.json`);
    process.env.FAKE_CLAUDE_DUMP = dump;
    await instance.adapter.sendTurn(turn);
    await recorder.until((e) => e.type === "turn.completed");
    return JSON.parse(readFileSync(dump, "utf8")).prompt;
  };

  it("sends image blocks ahead of the text", async () => {
    const prompt = await promptSentFor({
      threadId: "t-images",
      text: "what is this?",
      images: [{ mime: "image/png", data: "aGVsbG8=" }],
    });
    expect(prompt.message.content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } },
      { type: "text", text: "what is this?" },
    ]);
  });

  it("leaves an image-free turn as a plain string prompt", async () => {
    const prompt = await promptSentFor({ threadId: "t-no-images", text: "hi" });
    expect(prompt.message.content).toBe("hi");
  });
});
