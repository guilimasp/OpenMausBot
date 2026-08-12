/** Pasted/dropped images, on their way to the model.
 *
 * Lives in its own file so the composer's patch against upstream stays a
 * handful of lines — see patches/README.md.
 */

export interface Attachment {
  /** image/png, image/jpeg, … */
  mime: string;
  /** base64, no data: prefix — same shape the harness uses for screen frames */
  data: string;
  name?: string;
}

/** Claude's vision pipeline downscales anything larger than this anyway, so
 * shrinking here costs nothing and keeps the thread file from ballooning. */
const MAX_EDGE = 1568;
/** Past this, a resized PNG is re-encoded as JPEG. Screenshots of text stay
 * PNG-crisp; photos, which is what gets big, lose nothing that matters. */
const PNG_BUDGET = 1_500_000;

const SUPPORTED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Per message. The server enforces the same cap — this one is only so the
 * composer stops collecting thumbnails nobody will send. */
export const MAX_ATTACHMENTS = 6;

/** Does this clipboard carry an image? Synchronous, so a paste handler can
 * decide whether to preventDefault before the event goes stale — copying a
 * file in Finder puts its *name* on the clipboard as text too, and that
 * should not land in the box next to the thumbnail. */
export function hasImages(data: DataTransfer | null): boolean {
  return data ? [...data.items].some((item) => item.kind === "file" && SUPPORTED.has(item.type)) : false;
}

/** The image files on a clipboard event, encoded and ready to send. Returns
 * [] for a plain-text paste, which is every other paste.
 *
 * Must be called synchronously from the paste handler: the DataTransfer is
 * only readable while the event is being dispatched. */
export async function imagesFromClipboard(data: DataTransfer | null): Promise<Attachment[]> {
  if (!data) return [];
  const files = [...data.items]
    .filter((item) => item.kind === "file" && SUPPORTED.has(item.type))
    .map((item) => item.getAsFile())
    .filter((f): f is File => f !== null);
  return encodeAll(files);
}

/** The image files of a drop or a file picker. */
export async function imagesFromFiles(files: FileList | File[]): Promise<Attachment[]> {
  return encodeAll(Array.from(files).filter((f) => SUPPORTED.has(f.type)));
}

async function encodeAll(files: File[]): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const file of files) {
    const encoded = await encode(file).catch(() => null);
    if (encoded) out.push(encoded);
  }
  return out;
}

async function encode(file: File): Promise<Attachment> {
  const original = { mime: file.type, data: await toBase64(file), name: file.name || undefined };
  // GIFs are left alone: drawing one to a canvas would keep the first frame
  // and silently throw the animation away.
  if (file.type === "image/gif") return original;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return original;
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && original.data.length <= PNG_BUDGET) {
    bitmap.close();
    return original;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return original;
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const png = canvas.toDataURL("image/png");
  const chosen =
    png.length <= PNG_BUDGET ? { url: png, mime: "image/png" } : { url: canvas.toDataURL("image/jpeg", 0.85), mime: "image/jpeg" };
  const data = chosen.url.slice(chosen.url.indexOf(",") + 1);
  // a re-encode that came out bigger is not worth having
  if (data.length >= original.data.length && scale === 1) return original;
  return { mime: chosen.mime, data, name: original.name };
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export const dataUrl = (a: { mime: string; data: string }) => `data:${a.mime};base64,${a.data}`;
