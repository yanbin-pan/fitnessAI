import { useId } from "react";
import { useT } from "../i18n/index.tsx";

/**
 * Where the day's numbers end and its conversation begins: a hairline with the section's name and, at its end, a small
 * All | Log switch (Log shows only what was logged). It replaces the Log only row, so the chat starts right under the
 * badges. Each option's tap area reaches 44 px tall beyond its drawn pill.
 */
export function FeedDivider({ chat, logOnly, onChange }: { chat: boolean; logOnly: boolean; onChange: (logOnly: boolean) => void }) {
  const t = useT();
  const name = useId();
  const options = [
    { value: false, label: t.day.showAll },
    { value: true, label: t.day.showLog },
  ];
  return (
    <div className="flex items-center gap-2.5 px-4 pt-4">
      <span aria-hidden="true" className="h-px w-4 bg-(--nm-lo)" />
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{chat ? t.day.chat : t.day.logbook}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-(--nm-lo)" />
      <fieldset className="pressed flex shrink-0 rounded-full p-0.5">
        <legend className="sr-only">{t.day.show}</legend>
        {options.map((option) => {
          const chosen = option.value === logOnly;
          return (
            <label
              key={option.label}
              className={`relative cursor-pointer rounded-full px-3 py-1 text-xs after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${chosen ? "raised-sm font-semibold text-ink" : "text-muted"}`}
            >
              <input type="radio" name={name} checked={chosen} onChange={() => onChange(option.value)} className="sr-only" />
              {option.label}
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}
