import type { Language } from "../shared.ts";
import type { LoopStep } from "./loop.ts";
import { LogItemsInput, UpdateEntryInput } from "./tools.ts";

/** A name as it reads mid-sentence: "Fried eggs" becomes "fried eggs", but "BLT sandwich" and "McFlurry" keep their capitals. */
export function midSentence(name: string): string {
  const trimmed = name.trim();
  const first = trimmed.split(/\s+/)[0] ?? "";
  const acronym = first.length > 1 && first === first.toUpperCase() && /[A-Z]/.test(first);
  const innerCapital = /[A-Z]/.test(first.slice(1));
  return acronym || innerCapital ? trimmed : trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

interface StepWords {
  /** How lists are joined: "a, b and c" in en-GB. */
  locale: string;
  /** German capitalises every noun, so its names keep their first letter. */
  lowercase: boolean;
  thinking: string;
  photo: string;
  photos: string;
  reply: string;
  logging: (names: string) => string;
  loggingNothing: string;
  updating: (name: string) => string;
  updatingNothing: string;
  working: string;
  more: (count: number) => string;
}

/** The phone's words for each step, in every language the app speaks (spec §6.3). */
const WORDS: Record<Language, StepWords> = {
  en: {
    locale: "en-GB", lowercase: true,
    thinking: "Thinking…", photo: "Looking at your photo…", photos: "Looking at your photos…", reply: "Writing a reply…",
    logging: (names) => `Logging ${names}…`, loggingNothing: "Logging…",
    updating: (name) => `Updating ${name}…`, updatingNothing: "Updating your log…",
    working: "Working…", more: (count) => `${count} more`,
  },
  it: {
    locale: "it-IT", lowercase: true,
    thinking: "Sto pensando…", photo: "Guardo la tua foto…", photos: "Guardo le tue foto…", reply: "Scrivo la risposta…",
    logging: (names) => `Registro ${names}…`, loggingNothing: "Registro…",
    updating: (name) => `Aggiorno ${name}…`, updatingNothing: "Aggiorno il diario…",
    working: "Ci sto lavorando…", more: (count) => `altri ${count}`,
  },
  zh: {
    locale: "zh-CN", lowercase: false,
    thinking: "思考中…", photo: "正在看你的照片…", photos: "正在看你的照片…", reply: "正在写回复…",
    logging: (names) => `正在记录${names}…`, loggingNothing: "正在记录…",
    updating: (name) => `正在更新${name}…`, updatingNothing: "正在更新你的记录…",
    working: "处理中…", more: (count) => `另外${count}项`,
  },
  lt: {
    locale: "lt-LT", lowercase: true,
    thinking: "Galvoju…", photo: "Žiūriu į jūsų nuotrauką…", photos: "Žiūriu į jūsų nuotraukas…", reply: "Rašau atsakymą…",
    logging: (names) => `Įrašau: ${names}…`, loggingNothing: "Įrašau…",
    updating: (name) => `Atnaujinu: ${name}…`, updatingNothing: "Atnaujinu jūsų žurnalą…",
    working: "Dirbu…", more: (count) => `dar ${count}`,
  },
  fr: {
    locale: "fr-FR", lowercase: true,
    thinking: "Réflexion…", photo: "J’examine votre photo…", photos: "J’examine vos photos…", reply: "Rédaction de la réponse…",
    logging: (names) => `J’enregistre : ${names}…`, loggingNothing: "Enregistrement…",
    updating: (name) => `Je mets à jour : ${name}…`, updatingNothing: "Mise à jour de votre journal…",
    working: "En cours…", more: (count) => `${count} de plus`,
  },
  de: {
    locale: "de-DE", lowercase: false,
    thinking: "Denke nach…", photo: "Schaue mir dein Foto an…", photos: "Schaue mir deine Fotos an…", reply: "Schreibe eine Antwort…",
    logging: (names) => `Trage ${names} ein…`, loggingNothing: "Trage ein…",
    updating: (name) => `Aktualisiere ${name}…`, updatingNothing: "Aktualisiere dein Tagebuch…",
    working: "Arbeite…", more: (count) => `${count} weitere`,
  },
  es: {
    locale: "es-ES", lowercase: true,
    thinking: "Pensando…", photo: "Mirando tu foto…", photos: "Mirando tus fotos…", reply: "Escribiendo la respuesta…",
    logging: (names) => `Registrando ${names}…`, loggingNothing: "Registrando…",
    updating: (name) => `Actualizando ${name}…`, updatingNothing: "Actualizando tu registro…",
    working: "Trabajando…", more: (count) => `${count} más`,
  },
};

/** "a", "a and b", "a, b and c", "a, b, c and 2 more", joined the way the language joins a list. */
function listOf(names: string[], words: StepWords): string {
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  return new Intl.ListFormat(words.locale, { type: "conjunction" }).format(more > 0 ? [...shown, words.more(more)] : shown);
}

/** What the coach is doing, in the words the phone shows (spec §6.3). Steps never reach the log: they name foods. */
export function stepText(step: LoopStep, photos: number, language: Language = "en"): string {
  const words = WORDS[language];
  const named = (name: string) => (words.lowercase ? midSentence(name) : name.trim());
  if (step.kind === "start") return photos === 0 ? words.thinking : photos === 1 ? words.photo : words.photos;
  if (step.kind === "reply") return words.reply;
  if (step.name === "log_items") {
    const parsed = LogItemsInput.safeParse(step.input);
    const names = parsed.success ? [...parsed.data.foods, ...parsed.data.exercises].map((item) => named(item.name)).filter(Boolean) : [];
    return names.length > 0 ? words.logging(listOf(names, words)) : words.loggingNothing;
  }
  if (step.name === "update_entry") {
    const parsed = UpdateEntryInput.safeParse(step.input);
    const first = parsed.success ? [...parsed.data.foods, ...parsed.data.exercises][0]?.name : undefined;
    return first ? words.updating(named(first)) : words.updatingNothing;
  }
  return words.working;
}
