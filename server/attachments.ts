/** Image attachments on a user turn.
 *
 * Kept out of the files upstream owns so the patches that carry this feature
 * stay a few lines each — see patches/README.md.
 */

export interface ImageAttachment {
  /** image/png, image/jpeg, … */
  mime: string;
  /** base64, no data: prefix — the same shape as a screen frame's png */
  data: string;
  name?: string;
}

const SUPPORTED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_IMAGES = 6;
/** base64 chars, so ~3.7MB of actual image — comfortably over Claude's own
 * 5MB-per-image limit once decoded is not the goal; staying under it is. */
const MAX_BASE64 = 5_000_000;

/** Whatever arrived on the wire → the images worth keeping. Anything
 * malformed, oversized, or of an unsupported type is dropped, never thrown:
 * a bad paste must not cost the user their message. */
export function sanitizeImages(input: unknown): ImageAttachment[] {
  if (!Array.isArray(input)) return [];
  const out: ImageAttachment[] = [];
  for (const raw of input) {
    if (out.length >= MAX_IMAGES) break;
    if (!raw || typeof raw !== "object") continue;
    const { mime, data, name } = raw as Record<string, unknown>;
    if (typeof mime !== "string" || !SUPPORTED.has(mime)) continue;
    if (typeof data !== "string" || data.length === 0 || data.length > MAX_BASE64) continue;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) continue;
    out.push({ mime, data, ...(typeof name === "string" && name ? { name: name.slice(0, 120) } : {}) });
  }
  return out;
}

/** The `content` of a stream-json user message for the Claude CLI: a plain
 * string when there is nothing attached (exactly what upstream sends), and
 * the Messages-API block array when there is. */
export function userContent(text: string, images?: ImageAttachment[]): unknown {
  if (!images?.length) return text;
  return [
    ...images.map((img) => ({
      type: "image",
      source: { type: "base64", media_type: img.mime, data: img.data },
    })),
    ...(text ? [{ type: "text", text }] : []),
  ];
}
