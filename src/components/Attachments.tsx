import { X } from "lucide-react";
import { dataUrl, type Attachment } from "@/lib/images";

/** The pending-image strip above the composer. */
export function AttachmentStrip({
  images,
  onRemove,
}: {
  images: Attachment[];
  onRemove: (index: number) => void;
}) {
  if (images.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-2 px-2">
      {images.map((img, i) => (
        <div key={i} className="group relative">
          <img
            src={dataUrl(img)}
            alt={img.name ?? "Pasted image"}
            className="size-16 rounded-lg border border-hairline/40 object-cover"
          />
          <button
            onClick={() => onRemove(i)}
            title="Remove"
            className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-hairline/40 bg-raised text-ink-secondary opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Images that came with a chat message, under its bubble. */
export function MessageImages({ images }: { images: Attachment[] }) {
  return (
    <div className="mt-2 flex flex-wrap justify-end gap-2">
      {images.map((img, i) => (
        <img
          key={i}
          src={dataUrl(img)}
          alt={img.name ?? "Attached image"}
          className="max-h-56 max-w-full rounded-lg border border-hairline/40"
        />
      ))}
    </div>
  );
}
