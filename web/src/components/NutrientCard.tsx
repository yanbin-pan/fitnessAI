import { useId, useState } from "react";
import { useT } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import { MODERATE, SIGNAL_KEYS } from "../shared.ts";
import type { NutrientLevel, NutrientSignals, SignalKey } from "../shared.ts";

// Vitamins, fats and sugar (2026-10-06 nutrients design): a word for each, never a number against a target, so the
// card reads as a nudge rather than a scorecard. Nothing is ever red: "a bit low" is grey, "a lot" a soft amber.

type Tone = "good" | "calm" | "heads-up";
const DOT: Record<Tone, string> = { good: "bg-good", calm: "bg-muted/50", "heads-up": "bg-watch" };

export function toneOf(key: SignalKey, level: NutrientLevel): Tone {
  if (MODERATE.includes(key)) return level === "high" ? "heads-up" : "good";
  return level === "low" ? "calm" : "good";
}

const FATS: readonly SignalKey[] = SIGNAL_KEYS.slice(0, 4);
const MICROS: readonly SignalKey[] = SIGNAL_KEYS.slice(4);
const STORAGE_KEY = "nutrients-open";

function remembered(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function Tile({ name, word, tone }: { name: string; word: string; tone: Tone }) {
  return (
    <li className="pressed rounded-2xl px-3 py-2">
      <p className="truncate text-xs text-muted">{name}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-sm font-medium">
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${DOT[tone]}`} />
        {word}
      </p>
    </li>
  );
}

export function NutrientCard({ signals }: { signals: NutrientSignals }) {
  const t = useT();
  const [open, setOpen] = useState(remembered);
  const panel = useId();
  const toggle = () => {
    setOpen((was) => {
      try {
        localStorage.setItem(STORAGE_KEY, was ? "0" : "1");
      } catch {
        // Only whether it opens next time depends on it.
      }
      return !was;
    });
  };
  const word = (key: SignalKey, level: NutrientLevel) => (MODERATE.includes(key) ? t.nutrients.moderate : t.nutrients.enough)[level];
  const group = (title: string, keys: readonly SignalKey[]) => {
    const shown = keys.filter((key) => signals.levels[key] !== undefined);
    if (shown.length === 0) return null;
    return (
      <div className="mt-3">
        <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
        <ul aria-label={title} className="mt-2 grid grid-cols-2 gap-2">
          {shown.map((key) => {
            const level = signals.levels[key] as NutrientLevel;
            return <Tile key={key} name={t.nutrients.names[key]} word={word(key, level)} tone={toneOf(key, level)} />;
          })}
        </ul>
      </div>
    );
  };
  const hasFats = FATS.some((key) => signals.levels[key] !== undefined);
  const hasMicros = MICROS.some((key) => signals.levels[key] !== undefined);

  return (
    <section className="raised mt-3 rounded-3xl">
      <button type="button" aria-expanded={open} aria-controls={open ? panel : undefined} onClick={toggle} className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
        <span>
          <span className="block text-sm font-medium">{t.nutrients.title}</span>
          <span className="block text-xs text-muted">{t.nutrients.caption}</span>
        </span>
        <Icon name="chevron_right" size={22} className={`shrink-0 text-muted transition-transform motion-reduce:transition-none ${open ? "-rotate-90" : "rotate-90"}`} />
      </button>
      {open && (
        <div id={panel} className="px-4 pb-4">
          {!hasFats ? (
            <p className="text-sm text-muted">{t.nutrients.empty}</p>
          ) : (
            <>
              {group(t.nutrients.fats, FATS)}
              {group(t.nutrients.micros, MICROS)}
              {!hasMicros && <p className="mt-3 px-1 text-xs text-muted">{t.nutrients.microsPending}</p>}
              {signals.levels.vitamin_d_ug === "low" && <p className="mt-3 px-1 text-xs text-muted">{t.nutrients.sunlight}</p>}
              <p className="mt-2 px-1 text-xs text-muted">{t.nutrients.disclaimer}</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
