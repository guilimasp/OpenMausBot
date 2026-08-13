// Chips for what is annexed to the next message, plus the window-wide
// file drop that creates them. Lives beside the composer input: a long
// paste collapses into a card instead of flooding the box, and a file
// dropped anywhere on the window attaches by path.
import { useEffect, useRef, useState } from "react";
import { ClipboardPaste, File as FileIcon, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { fileAnnex, formatSize, pasteAnnex, pasteSummary, type Annex } from "@/lib/composer-attachments";

// A drag that carries no real file (out of a web page, say) has no path to
// attach; small text still has content worth keeping, so it lands as a paste.
const INLINE_LIMIT = 512 * 1024;
const isTextish = (f: File) => f.type.startsWith("text/") || f.type === "application/json";

export function ComposerAnnexes({
  items,
  onAdd,
  onRemove,
}: {
  items: Annex[];
  onAdd: (annexes: Annex[]) => void;
  onRemove: (id: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // dragenter/dragleave fire per element crossed, so the overlay tracks
  // depth rather than the last event it happened to see
  const depth = useRef(0);

  useEffect(() => {
    const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth.current += 1;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    // without this the window navigates to the dropped file and the app is gone
    const onOver = (e: DragEvent) => {
      if (carriesFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      const made: Annex[] = [];
      const pathless: string[] = [];
      for (const f of files) {
        const path = window.ogb?.getPathForFile?.(f) ?? "";
        if (path) made.push(fileAnnex(f.name, path, f.size));
        else if (isTextish(f) && f.size <= INLINE_LIMIT) {
          void f.text().then((t) => onAdd([pasteAnnex(t)]));
        } else pathless.push(f.name);
      }
      if (made.length) onAdd(made);
      setNotice(
        pathless.length
          ? `${pathless.join(", ")} — that drag carried no file on disk. Save it first, then drop it from Finder.`
          : null,
      );
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [onAdd]);

  return (
    <>
      {dragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-10">
          <div className="rounded-2xl border-2 border-dashed border-accent/70 bg-panel/90 px-8 py-6 text-[14px] font-medium text-ink shadow-2xl">
            Drop to attach — the bot gets the file path
          </div>
        </div>
      )}

      {notice && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          <span className="min-w-0 flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="shrink-0 rounded p-0.5">
            <X size={12} />
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {items.map((a) =>
            a.kind === "paste" ? (
              <PasteChip key={a.id} text={a.text} onRemove={() => onRemove(a.id)} />
            ) : (
              <FileChip key={a.id} name={a.name} size={a.size} onRemove={() => onRemove(a.id)} />
            ),
          )}
        </div>
      )}
    </>
  );
}

/** The pasted block itself, shown as the first few lines fading out. */
function PasteChip({ text, onRemove }: { text: string; onRemove: () => void }) {
  return (
    <Chip onRemove={onRemove} label="PASTED" title={text.slice(0, 4000)}>
      <div className="relative h-[76px] overflow-hidden">
        <pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] leading-[1.45] text-ink-secondary">
          {text.slice(0, 400)}
        </pre>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-b from-transparent to-raised" />
      </div>
      <div className="mt-1 text-[10.5px] text-ink-secondary/70">{pasteSummary(text)}</div>
    </Chip>
  );
}

function FileChip({ name, size, onRemove }: { name: string; size: number; onRemove: () => void }) {
  return (
    <Chip onRemove={onRemove} label="FILE" title={name}>
      <div className="flex h-[76px] items-center gap-2">
        <FileIcon size={16} className="shrink-0 text-ink-secondary" />
        <div className="min-w-0">
          <div className="truncate text-[12px] text-ink">{name}</div>
          <div className="text-[10.5px] text-ink-secondary/70">{formatSize(size)}</div>
        </div>
      </div>
    </Chip>
  );
}

function Chip({
  children,
  label,
  title,
  onRemove,
}: {
  children: React.ReactNode;
  label: string;
  title: string;
  onRemove: () => void;
}) {
  return (
    <div
      title={title}
      className={cn(
        "group relative w-[172px] rounded-xl border border-hairline/40 bg-raised px-2.5 py-2",
        "transition-colors hover:border-hairline",
      )}
    >
      {children}
      <div className="mt-1 flex items-center gap-1">
        {label === "PASTED" ? (
          <ClipboardPaste size={11} className="text-ink-secondary/70" />
        ) : (
          <FileIcon size={11} className="text-ink-secondary/70" />
        )}
        <span className="rounded border border-hairline/60 px-1 py-px text-[9.5px] font-medium tracking-wide text-ink-secondary">
          {label}
        </span>
      </div>
      <button
        onClick={onRemove}
        aria-label={`Remove ${label.toLowerCase()}`}
        className="absolute -right-1.5 -top-1.5 hidden size-5 items-center justify-center rounded-full border border-hairline/60 bg-panel text-ink-secondary hover:text-ink group-hover:flex"
      >
        <X size={11} />
      </button>
    </div>
  );
}
