import type { ReactNode } from "react";

/**
 * The little Markdown the coach writes (2026-10-20): **bold**, *italic* or _italic_, `code`, bullet and numbered
 * lists, and line breaks. Built as React elements, never as HTML, so a reply can't inject markup; anything else shows
 * as typed. Underscores only count at word edges, so snake_case stays as typed.
 */
const INLINE = /(\*\*[^*\n]+?\*\*|(?<!\w)__[^_\n]+?__(?!\w)|\*[^*\s][^*\n]*?\*|(?<!\w)_[^_\s][^_\n]*?_(?!\w)|`[^`\n]+?`)/g;

function inline(text: string, key: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const k = `${key}-${i}`;
    if (/^(\*\*|__).+\1$/.test(part)) return <strong key={k} className="font-semibold">{part.slice(2, -2)}</strong>;
    if (/^`.+`$/.test(part)) return <code key={k} className="rounded bg-black/5 px-1 text-[0.92em] dark:bg-white/10">{part.slice(1, -1)}</code>;
    // A single * or _ only counts with no space just inside it, so "2 * 3" stays as typed.
    if (/^([*_])[^\s].*[^\s]\1$|^([*_])[^\s]\2$/.test(part)) return <em key={k}>{part.slice(1, -1)}</em>;
    return part;
  });
}

type Block = { kind: "p"; lines: string[] } | { kind: "ul" | "ol"; items: string[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const line of text.split("\n")) {
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const last = out[out.length - 1];
    if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      const item = (bullet ?? numbered)![1];
      if (last?.kind === kind) last.items.push(item);
      else out.push({ kind, items: [item] });
    } else if (line.trim() === "") {
      if (last && !(last.kind === "p" && last.lines.length === 0)) out.push({ kind: "p", lines: [] });
    } else if (last?.kind === "p") {
      last.lines.push(line);
    } else {
      out.push({ kind: "p", lines: [line] });
    }
  }
  return out.filter((b) => (b.kind === "p" ? b.lines.length > 0 : true));
}

/** A coach's message with its Markdown drawn. `className` goes on the wrapper, which takes the bubble's styling. */
export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {blocks(text).map((block, b) => {
        if (block.kind === "p") {
          return (
            <p key={b}>
              {block.lines.map((line, l) => (
                <span key={l}>
                  {l > 0 && <br />}
                  {inline(line, `${b}-${l}`)}
                </span>
              ))}
            </p>
          );
        }
        const List = block.kind;
        return (
          <List key={b} className={`flex flex-col gap-0.5 pl-5 ${block.kind === "ul" ? "list-disc" : "list-decimal"}`}>
            {block.items.map((item, i) => (
              <li key={i}>{inline(item, `${b}-${i}`)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
