import { useId } from "react";

/** Text boxes and selects: pressed into the surface (spec §11.4). */
export const fieldClass = "pressed mt-1 w-full rounded-xl px-3 py-2 text-base text-ink placeholder:text-muted";

/** The one strong action on a screen, filled with the accent. */
export const primaryButton =
  "tap rounded-2xl bg-accent px-5 py-3 font-semibold text-on-accent shadow-[3px_3px_6px_var(--nm-lo),-3px_-3px_6px_var(--nm-hi)] disabled:opacity-50";

/** Every other button: raised from the surface. It sets no text colour, so the button takes the page's ink and a colour class added beside it applies. */
export const quietButton = "tap raised-sm rounded-2xl px-4 py-2 font-medium disabled:opacity-50";

/** A small choice of options: a pressed-in well with the chosen option raised. */
export function Segmented<T extends string>({
  legend, options, value, onChange,
}: {
  legend: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <fieldset>
      <legend className="text-sm">{legend}</legend>
      <div className="pressed mt-1 flex gap-1 rounded-2xl p-1">
        {options.map((option) => {
          const chosen = option.value === value;
          return (
            <label
              key={option.value}
              className={`flex-1 cursor-pointer rounded-xl py-2 text-center text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${chosen ? "raised-sm font-semibold text-ink" : "text-muted"}`}
            >
              <input type="radio" name={name} value={option.value} checked={chosen} onChange={() => onChange(option.value)} className="sr-only" />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** An on/off switch: a pressed-in track with a raised knob that turns green when on. */
export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 rounded-full text-xs text-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
      {label}
      <input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" />
      <span aria-hidden="true" className="pressed relative inline-block h-5 w-9 rounded-full">
        <span
          className={`raised-sm absolute left-0.5 top-0.5 h-4 w-4 rounded-full transition-transform ${checked ? "translate-x-4" : ""}`}
          style={checked ? { backgroundColor: "var(--nm-accent)" } : undefined}
        />
      </span>
    </label>
  );
}
