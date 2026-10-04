import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { ApiError, api } from "../api.ts";
import { Icon } from "../icons/Icon.tsx";
import { preparePhoto } from "../photos/prepare.ts";
import { storeDay } from "../queries.ts";
import { MAX_PHOTOS_PER_MESSAGE } from "../shared.ts";
import type { MessageInput, MessageResult, PhotoUpload } from "../shared.ts";

interface Attachment {
  key: string;
  /** An object URL for the thumbnail, revoked when the attachment goes. */
  preview: string;
  status: "preparing" | "uploading" | "ready" | "failed";
  /** The resized JPEG, kept so a failed upload can be retried. */
  blob: Blob | null;
  photoId: string | null;
}

function sendError(error: unknown): string {
  if (error instanceof ApiError && error.kind === "offline") return "You're offline, so the message may not have been sent. Tap Send to try again.";
  if (error instanceof ApiError && error.kind === "signed_out") return "You're signed out. Sign in again, then resend.";
  if (error instanceof ApiError && error.code === "in_progress") return "The coach is still working on that message. Give it a moment, then tap Send.";
  // Sending again can't change either of these, and uploading the photos again by itself could log the same meal twice,
  // so the person is told what to do instead.
  if (error instanceof ApiError && error.code === "photo_taken") return "Those photos went with your last message. Remove them to send this one.";
  if (error instanceof ApiError && error.code === "photo_not_found") return "A photo is no longer on the server. Remove it and attach it again.";
  return "Couldn't send. Try again.";
}

/** Talks to the coach about today: text — voice works through the keyboard's microphone — and up to four photos. */
export function Composer() {
  const client = useQueryClient();
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

  const send = useMutation({
    mutationFn: (body: MessageInput) => api<MessageResult>("/api/messages", { json: body }),
    onSuccess: (result) => {
      attempt.current = null;
      storeDay(client, result.day);
      setText("");
      setNotice(null);
      setAttachments((list) => {
        for (const a of list) URL.revokeObjectURL(a.preview);
        return [];
      });
    },
    // A lost reply may still have reached the server: look again, and the pending poll shows the reply when it lands.
    onError: () => void client.invalidateQueries({ queryKey: ["day"] }),
  });

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
          setNotice("That photo can't be sent. Try another.");
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
        setNotice("That photo couldn't be read. Try another.");
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

  function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ""; // so choosing the same photo again still counts as a change
    const room = MAX_PHOTOS_PER_MESSAGE - attachments.length;
    setNotice(files.length > room ? `Up to ${MAX_PHOTOS_PER_MESSAGE} photos per message.` : null);
    send.reset();
    for (const file of files.slice(0, Math.max(0, room))) void add(file);
  }

  const trimmed = text.trim();
  const busy = attachments.some((a) => a.status === "preparing" || a.status === "uploading");
  const failed = attachments.some((a) => a.status === "failed");
  const full = attachments.length >= MAX_PHOTOS_PER_MESSAGE;
  const canSend = !send.isPending && !busy && !failed && (trimmed !== "" || attachments.length > 0);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;
    const photoIds = attachments.map((a) => a.photoId).filter((id): id is string => id !== null);
    const key = JSON.stringify([trimmed, photoIds]);
    if (attempt.current?.key !== key) {
      attempt.current = { key, input: { id: crypto.randomUUID(), sent_at: new Date().toISOString(), text: trimmed, photo_ids: photoIds } };
    }
    send.mutate(attempt.current.input);
  }

  // The band behind the card is the page colour, so the feed scrolling under it never shows between the card and the tab bar.
  return (
    <form ref={form} onSubmit={submit} className="fixed inset-x-0 bottom-[calc(var(--tabbar-h)_+_env(safe-area-inset-bottom))] z-10 bg-base px-3 pt-2 pb-2">
      <div className="raised mx-auto max-w-xl rounded-3xl p-2">
        {attachments.length > 0 && (
          <ul aria-label="Attached photos" className="mb-2 flex gap-2 px-1 pt-1.5">
            {attachments.map((a, index) => (
              <li key={a.key} className="relative">
                <img src={a.preview} alt={`Photo ${index + 1}`} className={`h-14 w-14 rounded-xl object-cover ${a.status === "failed" ? "opacity-40" : ""}`} />
                {(a.status === "preparing" || a.status === "uploading") && (
                  <span role="status" aria-label={`Uploading photo ${index + 1}`} className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/30">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  </span>
                )}
                {a.status === "failed" && a.blob && (
                  <button
                    type="button"
                    aria-label={`Retry photo ${index + 1}`}
                    onClick={() => void upload(a.key, a.blob as Blob)}
                    className="absolute inset-0 flex items-center justify-center rounded-xl text-danger"
                  >
                    <Icon name="refresh" size={24} />
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Remove photo ${index + 1}`}
                  disabled={send.isPending}
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
            className={`tap raised-sm flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${full || send.isPending ? "opacity-40" : "cursor-pointer"}`}
          >
            <Icon name="add_a_photo" size={22} />
            <input type="file" accept="image/*" multiple aria-label="Add photos" disabled={full || send.isPending} onChange={onFiles} className="sr-only" />
          </label>
          <textarea
            aria-label="Message your coach"
            rows={1}
            value={text}
            // Locked while a send is out, so nothing typed can be wiped when the reply arrives.
            readOnly={send.isPending}
            onChange={(event) => setText(event.target.value)}
            placeholder={attachments.length > 0 ? "Add a note, or just send" : "What did you eat or do?"}
            className="pressed field-sizing-content max-h-36 min-h-11 flex-1 resize-none rounded-2xl px-3 py-2.5 text-base text-ink placeholder:text-muted"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={!canSend}
            className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent shadow-[3px_3px_6px_var(--nm-lo),-3px_-3px_6px_var(--nm-hi)] disabled:opacity-40"
          >
            {send.isPending ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <Icon name="arrow_upward" size={22} />
            )}
          </button>
        </div>
        {notice && (
          <p role="status" className="mt-1.5 px-2 text-xs text-muted">
            {notice}
          </p>
        )}
        {failed && (
          <p role="alert" className="mt-1.5 px-2 text-sm text-danger">
            A photo didn't upload. Tap it to try again.
          </p>
        )}
        {send.isError && (
          <p role="alert" className="mt-1.5 px-2 text-sm text-danger">
            {sendError(send.error)}
          </p>
        )}
      </div>
    </form>
  );
}
