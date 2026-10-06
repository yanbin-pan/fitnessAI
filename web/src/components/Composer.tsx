import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, FormEvent } from "react";
import { ApiError, api } from "../api.ts";
import { dropLive, finishLive, firstStep, pushStep, startLive } from "../coach/live.ts";
import { addPending, removePending } from "../coach/pending.ts";
import { streamCoach } from "../coach/stream.ts";
import { useT } from "../i18n/index.tsx";
import type { Messages } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import { preparePhoto } from "../photos/prepare.ts";
import { storeDay } from "../queries.ts";
import { MAX_PHOTOS_PER_MESSAGE } from "../shared.ts";
import type { EntryResult, MessageInput, PhotoUpload, Regular } from "../shared.ts";
import { sportOf } from "./SportBadge.tsx";

interface Attachment {
  key: string;
  /** An object URL for the thumbnail, revoked when the attachment goes. */
  preview: string;
  status: "preparing" | "uploading" | "ready" | "failed";
  /** The resized JPEG, kept so a failed upload can be retried. */
  blob: Blob | null;
  photoId: string | null;
}

function sendError(error: unknown, t: Messages): string {
  if (error instanceof ApiError && error.kind === "offline") return t.composer.offline;
  if (error instanceof ApiError && error.kind === "signed_out") return t.composer.signedOut;
  if (error instanceof ApiError && error.code === "in_progress") return t.composer.inProgress;
  // Sending again can't change either of these, and uploading the photos again by itself could log the same meal twice,
  // so the person is told what to do instead.
  if (error instanceof ApiError && error.code === "photo_taken") return t.composer.photoTaken;
  if (error instanceof ApiError && error.code === "photo_not_found") return t.composer.photoNotFound;
  return t.composer.failed;
}

/** The images on a pasted clipboard: a screenshot copied on the phone, a photo copied from another app. */
export function imagesIn(data: DataTransfer | null): File[] {
  if (!data) return [];
  // Some browsers list a pasted image under both items and files: take it from one place only.
  const fromItems = Array.from(data.items ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
  return fromItems.length > 0 ? fromItems : Array.from(data.files ?? []).filter((file) => file.type.startsWith("image/"));
}

/**
 * The images on the clipboard, asked of the clipboard itself. iOS Safari can paste into a plain text box without
 * handing the box the image it lists; reading the clipboard during that same paste still gets it.
 */
export async function clipboardImages(): Promise<File[]> {
  if (typeof navigator.clipboard?.read !== "function") return [];
  const files: File[] = [];
  for (const item of await navigator.clipboard.read()) {
    const type = item.types.find((t) => t.startsWith("image/"));
    if (type) files.push(new File([await item.getType(type)], `pasted.${type.slice(6)}`, { type }));
  }
  return files;
}

/** Today's regulars, due around now (2026-10-06 design §2.2): one tap logs one, without a word to the coach. */
function RegularChips({ suggestions }: { suggestions: Regular[] }) {
  const client = useQueryClient();
  const t = useT();
  // The id belongs to the tap, not the request: if the answer is lost, tapping again sends the same id and logs it once.
  const ids = useRef(new Map<string, string>());
  const log = useMutation({
    mutationFn: (regular: Regular) => {
      const id = ids.current.get(regular.key) ?? crypto.randomUUID();
      ids.current.set(regular.key, id);
      return api<EntryResult>(`/api/regulars/${regular.key}/log`, { json: { id } });
    },
    onSuccess: (result, regular) => {
      ids.current.delete(regular.key);
      storeDay(client, result.day);
      void client.invalidateQueries({ queryKey: ["regulars"] });
    },
  });
  if (suggestions.length === 0) return null;
  return (
    <div className="mb-1">
      <ul aria-label={t.regulars.chips} className="flex gap-2 overflow-x-auto px-1 pt-1 pb-2">
        {suggestions.map((regular) => {
          const kcal = `${Math.round(regular.kcal)} ${t.units.kcal}`;
          const icon = regular.kind === "meal" ? "restaurant" : sportOf(regular.exercises[0]?.activity ?? "other").icon;
          return (
            <li key={regular.key} className="shrink-0">
              <button
                type="button"
                disabled={log.isPending}
                aria-label={t.regulars.log(regular.name, kcal)}
                onClick={() => {
                  log.reset();
                  log.mutate(regular);
                }}
                className="tap raised-sm flex max-w-64 items-center gap-1.5 rounded-full py-2 pl-2.5 pr-3 text-sm disabled:opacity-50"
              >
                <Icon name={icon} size={16} className="shrink-0 text-accent-ink" />
                <span className="truncate">{regular.name}</span>
                <span className="shrink-0 text-xs text-muted">{kcal}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {log.isError && (
        <p role="alert" className="px-2 pb-1 text-sm text-danger">
          {t.regulars.logFailed}
        </p>
      )}
    </div>
  );
}

/** Talks to the coach about today: text — voice works through the keyboard's microphone — and up to four photos. */
/** The chat for the day open in the app (`date`): today, or one of the days before it it can still fill in (spec §6.6). */
export function Composer({ date, suggestions = [] }: { date: string; suggestions?: Regular[] }) {
  const client = useQueryClient();
  const t = useT();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // The id and timestamp belong to the unsent message, not to each tap on Send. If a response is
  // lost after the server has already run the coach, sending the same message again must carry
  // the same id, so the server hands back what it stored instead of logging the meal twice (spec 6.3).
  const attempt = useRef<{ key: string; input: MessageInput } | null>(null);
  // Attachments that are gone (removed, or left behind when the composer went away) while their photo
  // was still being prepared: don't upload those.
  const removed = useRef(new Set<string>());
  // Photos are prepared one at a time, each after the one before has finished: decoding several
  // full-size photos at once can use up an iPhone's memory and get the page killed. Uploads may overlap.
  const preparing = useRef<Promise<unknown>>(Promise.resolve());
  // The list as last rendered, for the cleanup on unmount.
  const latest = useRef(attachments);
  useEffect(() => {
    latest.current = attachments;
  }, [attachments]);
  useEffect(
    () => () => {
      // Leaving removes every photo, so one still being prepared isn't uploaded for a message nobody will send.
      for (const a of latest.current) {
        removed.current.add(a.key);
        URL.revokeObjectURL(a.preview);
      }
    },
    [],
  );
  // Photos, a notice, an alert or a longer message change how tall the composer is. The page behind it needs
  // that height (as --composer-h) to leave room, so the end of the feed can always scroll clear of the composer.
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const element = form.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--composer-h", `${Math.ceil(element.getBoundingClientRect().height)}px`);
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--composer-h");
    };
  }, []);

  // "storing": sent but not yet stored, so the composer is locked in case the message has to come back to it.
  // "working": stored and with the coach; typing is fine, sending waits for the reply (spec §11.1).
  const [phase, setPhase] = useState<"idle" | "storing" | "working">("idle");
  const [sendFailure, setSendFailure] = useState<unknown>(null);

  const patch = (key: string, changes: Partial<Attachment>) =>
    setAttachments((list) => list.map((a) => (a.key === key ? { ...a, ...changes } : a)));

  // Object URLs are revoked inside the updaters on purpose: an updater always sees the current list,
  // and revoking a URL twice is harmless.
  function remove(key: string) {
    removed.current.add(key);
    setAttachments((list) => {
      const gone = list.find((a) => a.key === key);
      if (gone) URL.revokeObjectURL(gone.preview);
      return list.filter((a) => a.key !== key);
    });
  }

  async function upload(key: string, blob: Blob) {
    patch(key, { status: "uploading" });
    try {
      const photo = await api<PhotoUpload>("/api/photos", { blob });
      patch(key, { status: "ready", photoId: photo.id });
    } catch (error) {
      // The server won't take this photo however often it is sent, so a retry would only fail again.
      if (error instanceof ApiError && (error.code === "image_too_large" || error.code === "not_an_image")) {
        if (!removed.current.has(key)) {
          remove(key);
          setNotice(t.composer.cantSend);
        }
        return;
      }
      patch(key, { status: "failed" });
    }
  }

  function prepareInTurn(file: File) {
    const prepared = preparing.current.then(() => preparePhoto(file));
    // The next photo waits for this one, whether or not it could be read.
    preparing.current = prepared.catch(() => {});
    return prepared;
  }

  async function add(file: File) {
    const key = crypto.randomUUID();
    // Made here, not inside the updater: React may run an updater twice, and each run would make a URL.
    const original = URL.createObjectURL(file);
    setAttachments((list) => [...list, { key, preview: original, status: "preparing", blob: null, photoId: null }]);
    let blob: Blob;
    try {
      ({ blob } = await prepareInTurn(file));
    } catch {
      // If it was removed in the meantime, there is nothing to report.
      if (!removed.current.has(key)) {
        remove(key);
        setNotice(t.composer.cantRead);
      }
      return;
    }
    if (removed.current.has(key)) return;
    const preview = URL.createObjectURL(blob);
    setAttachments((list) => {
      if (!list.some((a) => a.key === key)) {
        URL.revokeObjectURL(preview);
        return list;
      }
      return list.map((a) => {
        if (a.key !== key) return a;
        URL.revokeObjectURL(a.preview);
        return { ...a, preview, blob };
      });
    });
    await upload(key, blob);
  }

  /** Attaches photos up to the message's limit, whether picked with the camera button or pasted. */
  function attach(files: File[]) {
    const room = MAX_PHOTOS_PER_MESSAGE - attachments.length;
    setNotice(files.length > room ? t.composer.tooMany(MAX_PHOTOS_PER_MESSAGE) : null);
    setSendFailure(null);
    for (const file of files.slice(0, Math.max(0, room))) void add(file);
  }

  function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ""; // so choosing the same photo again still counts as a change
    attach(files);
  }

  // A screenshot pasted into the text box becomes a photo, as if picked with the camera button.
  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (phase === "storing") return;
    const hasText = Array.from(event.clipboardData?.types ?? []).includes("text/plain");
    const images = imagesIn(event.clipboardData);
    if (images.length > 0) {
      // Words copied along with the image (part of a web page) still paste into the box; an image on its own
      // must not, or some browsers write its file name there.
      if (!hasText) event.preventDefault();
      attach(images);
      return;
    }
    if (hasText) return; // plain text pastes as usual
    // Nothing the box can use: most likely an image the browser kept back. Ask the clipboard for it; the read must
    // start now, while the paste is still the person's own gesture.
    event.preventDefault();
    clipboardImages().then(
      (files) => (files.length > 0 ? attach(files) : setNotice(t.composer.cantPaste)),
      () => setNotice(t.composer.cantPaste),
    );
  }

  const trimmed = text.trim();
  const busy = attachments.some((a) => a.status === "preparing" || a.status === "uploading");
  const failed = attachments.some((a) => a.status === "failed");
  const full = attachments.length >= MAX_PHOTOS_PER_MESSAGE;
  const canSend = phase === "idle" && !busy && !failed && (trimmed !== "" || attachments.length > 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;
    const photoIds = attachments.map((a) => a.photoId).filter((id): id is string => id !== null);
    const key = JSON.stringify([trimmed, photoIds]);
    if (attempt.current?.key !== key) {
      attempt.current = { key, input: { id: crypto.randomUUID(), sent_at: new Date().toISOString(), date, text: trimmed, photo_ids: photoIds } };
    }
    const input = attempt.current.input;
    // What goes back into the composer if the message never reaches the server.
    const sent = { text, attachments };
    setSendFailure(null);
    setNotice(null);
    setText("");
    setAttachments([]);
    setPhase("storing");
    startLive(input.id, firstStep(input.photo_ids.length, t));
    // A message the feed has already is the server's own copy, from an earlier try: it is not ours to take out again.
    const added = addPending(client, input, date);
    let stored = false;
    try {
      const result = await streamCoach("/api/messages", input, (step) => {
        if (step.type === "stored") {
          stored = true;
          storeDay(client, step.day);
          setPhase("working");
        } else {
          pushStep(input.id, step.text);
        }
      });
      finishLive(input.id);
      storeDay(client, result.day);
      attempt.current = null;
      for (const a of sent.attachments) URL.revokeObjectURL(a.preview);
    } catch (error) {
      if (stored) {
        // The server has the message and the coach is on it: the pending poll shows the reply when it lands.
        dropLive(input.id);
        attempt.current = null;
        for (const a of sent.attachments) URL.revokeObjectURL(a.preview);
      } else {
        // It may never have arrived: put it back, so sending again carries the same id (spec §6.3).
        finishLive(input.id);
        if (added) removePending(client, input.id, date);
        setText(sent.text);
        setAttachments(sent.attachments);
        setSendFailure(error);
      }
      // Either way the screen may be out of step with the server: look again.
      void client.invalidateQueries({ queryKey: ["day"] });
    } finally {
      setPhase("idle");
    }
  }

  // The band behind the card is the page colour, so the feed scrolling under it never shows between the card and the tab bar.
  return (
    <form ref={form} onSubmit={(event) => void submit(event)} className="fixed inset-x-0 bottom-[calc(var(--tabbar-h)_+_env(safe-area-inset-bottom))] z-10 bg-base px-3 pt-2 pb-2">
      <div className="raised mx-auto max-w-xl rounded-3xl p-2">
        <RegularChips suggestions={suggestions} />
        {attachments.length > 0 && (
          <ul aria-label={t.composer.attached} className="mb-2 flex gap-2 px-1 pt-1.5">
            {attachments.map((a, index) => (
              <li key={a.key} className="relative">
                <img src={a.preview} alt={t.common.photo(index + 1)} className={`h-14 w-14 rounded-xl object-cover ${a.status === "failed" ? "opacity-40" : ""}`} />
                {(a.status === "preparing" || a.status === "uploading") && (
                  <span role="status" aria-label={t.composer.uploading(index + 1)} className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/30">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  </span>
                )}
                {a.status === "failed" && a.blob && (
                  <button
                    type="button"
                    aria-label={t.composer.retryPhoto(index + 1)}
                    onClick={() => void upload(a.key, a.blob as Blob)}
                    className="absolute inset-0 flex items-center justify-center rounded-xl text-danger"
                  >
                    <Icon name="refresh" size={24} />
                  </button>
                )}
                <button
                  type="button"
                  aria-label={t.composer.removePhoto(index + 1)}
                  disabled={phase === "storing"}
                  onClick={() => remove(a.key)}
                  className="raised-sm absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-ink disabled:opacity-40"
                >
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <label
            className={`tap raised-sm flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${full || phase === "storing" ? "opacity-40" : "cursor-pointer"}`}
          >
            <Icon name="add_a_photo" size={22} />
            <input type="file" accept="image/*" multiple aria-label={t.composer.addPhotos} disabled={full || phase === "storing"} onChange={onFiles} className="sr-only" />
          </label>
          <textarea
            aria-label={t.composer.message}
            rows={1}
            value={text}
            // Locked until the server has the message, so it can come back here intact.
            readOnly={phase === "storing"}
            onChange={(event) => setText(event.target.value)}
            onPaste={onPaste}
            placeholder={attachments.length > 0 ? t.composer.placeholderPhotos : t.composer.placeholder}
            className="pressed field-sizing-content max-h-36 min-h-11 flex-1 resize-none rounded-2xl px-3 py-2.5 text-base text-ink placeholder:text-muted"
          />
          <button
            type="submit"
            aria-label={t.composer.send}
            disabled={!canSend}
            className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent shadow-[3px_3px_6px_var(--nm-lo),-3px_-3px_6px_var(--nm-hi)] disabled:opacity-40"
          >
            <Icon name="arrow_upward" size={22} />
          </button>
        </div>
        {notice && (
          <p role="status" className="mt-1.5 px-2 text-xs text-muted">
            {notice}
          </p>
        )}
        {failed && (
          <p role="alert" className="mt-1.5 px-2 text-sm text-danger">
            {t.composer.uploadFailed}
          </p>
        )}
        {sendFailure !== null && (
          <p role="alert" className="mt-1.5 px-2 text-sm text-danger">
            {sendError(sendFailure, t)}
          </p>
        )}
      </div>
    </form>
  );
}
