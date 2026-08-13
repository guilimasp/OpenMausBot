// Pasted images: what the wire is allowed to carry, and what the Claude CLI
// is handed for it.
import { describe, expect, it } from "vitest";

import { sanitizeImages, userContent } from "./attachments.ts";

const png = { mime: "image/png", data: "aGVsbG8=" };

describe("sanitizeImages", () => {
  it("keeps well-formed images", () => {
    expect(sanitizeImages([png])).toEqual([png]);
  });

  it("drops anything that is not a supported image", () => {
    expect(sanitizeImages([{ mime: "application/pdf", data: "aGk=" }])).toEqual([]);
    expect(sanitizeImages([{ mime: "image/png", data: "not base64!" }])).toEqual([]);
    expect(sanitizeImages([{ mime: "image/png" }, null, "nope", 7])).toEqual([]);
    expect(sanitizeImages(undefined)).toEqual([]);
  });

  it("refuses an image too big to be worth sending", () => {
    expect(sanitizeImages([{ mime: "image/png", data: "a".repeat(5_000_001) }])).toEqual([]);
  });

  it("caps how many ride on one message", () => {
    expect(sanitizeImages(Array.from({ length: 20 }, () => png))).toHaveLength(6);
  });
});

describe("userContent", () => {
  it("stays a plain string when nothing is attached", () => {
    expect(userContent("hi")).toBe("hi");
    expect(userContent("hi", [])).toBe("hi");
  });

  it("becomes image blocks plus the text", () => {
    expect(userContent("what is this?", [png])).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: png.data } },
      { type: "text", text: "what is this?" },
    ]);
  });

  it("sends an image with no words as image blocks alone", () => {
    expect(userContent("", [png])).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: png.data } },
    ]);
  });
});
