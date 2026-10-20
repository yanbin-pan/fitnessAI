import { useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { api } from "../api.ts";
import { useT } from "../i18n/index.tsx";
import { Icon } from "../icons/Icon.tsx";
import { useHealthChat } from "../queries.ts";
import { labFlag } from "../shared.ts";
import type { ChatMessageView, DocumentReadView, HealthChatView, SuggestionView } from "../shared.ts";
import { Screen, WithHealth, documentTitle, factName, failure, sectionOf, uploadPhotos, useRecordsWrite } from "./common.tsx";
import { noteHealthNews } from "./background.ts";
import { ReviewSheet } from "./ReviewSheet.tsx";
import { Markdown } from "../components/Markdown.tsx";

// The Health chat (2026-10-19 health tab design §4, from direction C): the person says what they have in their own
// words, the coach answers and proposes facts, and nothing reaches the profile until they tap Add.

function Suggestion({ suggestion, ticked, onTick }: { suggestion: SuggestionView; ticked: boolean; onTick?: (ticked: boolean) => void }) {
  const t = useT();
  const fact = suggestion.fact;
  return (
    <li>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 px-4 py-3">
        {onTick && (
          <input
            type="checkbox"
            checked={ticked}
            onChange={(event) => onTick(event.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--nm-accent)]"
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted">{t.health.kinds[fact.kind]}</span>
          <span className="block text-[15px] font-semibold">{factName(fact, t)}</span>
          {(fact.detail || fact.level) && (
            <span className="block text-xs text-muted">{[fact.level && t.health.levels[fact.level], fact.detail].filter(Boolean).join(" · ")}</span>
          )}
        </span>
      </label>
    </li>
  );
}

/** What the coach proposes on one message: a card with Add and Not now while pending, then one line each with Undo. */
function Proposals({ suggestions }: { suggestions: SuggestionView[] }) {
  const t = useT();
  const pending = suggestions.filter((s) => s.status === "pending");
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const isTicked = (s: SuggestionView) => ticked[s.id] ?? true;
  const act = useRecordsWrite(async ({ action, ids }: { action: "accept" | "dismiss" | "undo"; ids: string[] }) => {
    for (const id of ids) await api<SuggestionView>(`/api/records/suggestions/${id}/${action}`, { method: "POST", json: {} });
  });
  const chosen = pending.filter(isTicked);
  return (
    <>
      {suggestions.filter((s) => s.status !== "pending").map((s) => {
        const name = factName(s.fact, t);
        const section = sectionOf(s.fact.kind);
        return (
          <p key={s.id} className="flex flex-wrap items-center gap-x-2 px-1 text-[13px] text-muted">
            {s.status === "added" && <span className="text-accent-ink"><Icon name="check" size={16} /></span>}
            <span>{s.status === "added" ? t.health.addedTo(name, section ? t.health.sections[section] : t.health.kinds[s.fact.kind]) : t.health.notAdded(name)}</span>
            <button
              type="button"
              disabled={act.isPending}
              onClick={() => act.mutate({ action: "undo", ids: [s.id] })}
              className="min-h-8 font-medium text-accent-ink"
            >
              {t.health.undo}
            </button>
          </p>
        );
      })}
      {pending.length > 0 && (
        <div className="raised rounded-3xl">
          <p className="flex items-center gap-2 px-4 pt-3.5 text-xs font-semibold text-accent-ink">
            <Icon name="ecg_heart" size={16} />
            {t.health.addToProfile}
          </p>
          <ul className="divide-y divide-muted/15">
            {pending.map((s) => (
              <Suggestion key={s.id} suggestion={s} ticked={isTicked(s)} onTick={pending.length > 1 ? (on) => setTicked({ ...ticked, [s.id]: on }) : undefined} />
            ))}
          </ul>
          {act.isError && <p role="alert" className="px-4 text-sm text-danger">{t.health.saveFailed}</p>}
          <div className="flex gap-2.5 px-4 pt-1 pb-4">
            <button
              type="button"
              disabled={act.isPending || chosen.length === 0}
              onClick={() => act.mutate({ action: "accept", ids: chosen.map((s) => s.id) })}
              className="tap h-11 flex-1 rounded-xl bg-accent text-[15px] font-semibold text-on-accent disabled:opacity-50"
            >
              {t.health.addCount(chosen.length)}
            </button>
            <button
              type="button"
              disabled={act.isPending}
              onClick={() => act.mutate({ action: "dismiss", ids: pending.map((s) => s.id) })}
              className="tap raised-sm h-11 rounded-xl px-4 text-[15px]"
            >
              {t.health.notNow}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function ReadMessage({ message, onCheck }: { message: ChatMessageView; onCheck: () => void }) {
  const t = useT();
  const read = message.read!;
  const outside = read.observations.filter((o) => ["low", "high"].includes(labFlag(o.value, o.ref_low, o.ref_high)));
  return (
    <div className="raised-sm rounded-[18px] rounded-bl-md px-3.5 py-3 text-[15px] leading-snug">
      <p>{t.health.readReply(documentTitle(read, t), read.observations.length)}</p>
      {read.summary && <p className="mt-1.5 text-sm text-muted">{read.summary}</p>}
      {outside.length > 0 && <p className="mt-1.5 text-sm">{t.health.readOutside(outside.map((o) => o.name).join(", "))}</p>}
      {message.saved_document_id ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted">
          <span className="text-accent-ink"><Icon name="check" size={16} /></span>
          {t.health.savedRecord}
          <Link to={`/health/records/${message.saved_document_id}`} className="font-medium text-accent-ink">{t.health.open}</Link>
        </p>
      ) : (
        <button type="button" onClick={onCheck} className="mt-2 min-h-9 font-medium text-accent-ink">{t.health.checkAndSave}</button>
      )}
    </div>
  );
}

function Message({ message, onCheck, onOption, last }: { message: ChatMessageView; onCheck: (m: ChatMessageView) => void; onOption: (text: string) => void; last: boolean }) {
  const t = useT();
  if (message.role === "user") {
    return (
      <li className="flex max-w-[85%] flex-col items-end gap-1 self-end">
        {message.photos > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <Icon name="photo_camera" size={14} />
            {t.health.photos(message.photos)}
          </span>
        )}
        {message.text && <p className="rounded-[18px] rounded-br-md bg-accent px-3.5 py-2.5 text-[15px] leading-snug text-on-accent">{message.text}</p>}
      </li>
    );
  }
  return (
    <li className="flex max-w-[92%] flex-col gap-2.5 self-start">
      {message.read ? (
        <ReadMessage message={message} onCheck={() => onCheck(message)} />
      ) : (
        <Markdown text={message.text} className="raised-sm rounded-[18px] rounded-bl-md px-3.5 py-3 text-[15px] leading-snug" />
      )}
      <Proposals suggestions={message.suggestions} />
      {last && message.options.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {message.options.map((option) => (
            <li key={option}>
              <button type="button" onClick={() => onOption(option)} className="tap raised-sm h-10 rounded-full px-3.5 text-sm">{option}</button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

interface Sending {
  words: string;
  files: File[];
}
const SENDING = ["health", "chat", "send"];

function Conversation() {
  const t = useT();
  const client = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const chat = useHealthChat();
  // "Ask about this record" arrives with the start of a question, for the person to finish.
  const [text, setText] = useState(() => (location.state as { draft?: string } | null)?.draft ?? "");
  const [checking, setChecking] = useState<{ read: DocumentReadView; messageId: string } | null>(null);
  // A message keeps going when the person leaves the chat (a photo takes tens of seconds to read): the answer lands in
  // the chat's cache either way, and one still on its way shows again on coming back.
  const send = useMutation({
    mutationKey: SENDING,
    mutationFn: async ({ words, files }: Sending) => {
      const photo_ids = files.length > 0 ? await uploadPhotos(files) : [];
      return api<HealthChatView>("/api/records/chat", { json: { id: crypto.randomUUID(), text: words, photo_ids } });
    },
    onSuccess: (view) => {
      setText("");
      client.setQueryData(["health", "chat"], view);
      void client.invalidateQueries({ queryKey: ["health"], exact: true });
      noteHealthNews();
    },
  });
  const away = useMutationState({ filters: { mutationKey: SENDING, status: "pending" }, select: (m) => m.state.variables as Sending });
  const sending = send.isPending ? send.variables : away[0];
  const busy = sending !== undefined;
  const sendText = (words: string) => {
    if (words.trim() && !busy) send.mutate({ words: words.trim(), files: [] });
  };

  // A sentence typed on the home arrives here and is sent at once, then cleared from the history so Back won't resend it.
  const handed = (location.state as { text?: string } | null)?.text;
  const sentHanded = useRef(false);
  useEffect(() => {
    if (!handed || sentHanded.current) return;
    sentHanded.current = true;
    navigate(location.pathname, { replace: true, state: null });
    send.mutate({ words: handed, files: [] });
  }, [handed, location.pathname, navigate, send]);

  const end = useRef<HTMLLIElement>(null);
  const count = chat.data?.messages.length ?? 0;
  useEffect(() => end.current?.scrollIntoView?.({ block: "end" }), [count, busy]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    sendText(text);
  };
  const messages = chat.data?.messages ?? [];
  const pendingText = sending?.words;
  return (
    <>
      <ul className="mt-4 flex flex-col gap-4 pb-[calc(var(--composer-h,5rem)_+_1rem)]">
        {messages.length === 0 && !busy && <li className="raised-sm self-start rounded-[18px] rounded-bl-md px-3.5 py-3 text-[15px] leading-snug">{t.health.chatEmpty}</li>}
        {messages.map((message, i) => (
          <Message
            key={message.id}
            message={message}
            last={i === messages.length - 1}
            onCheck={(m) => setChecking({ read: m.read!, messageId: m.id })}
            onOption={sendText}
          />
        ))}
        {pendingText && <li className="max-w-[85%] self-end rounded-[18px] rounded-br-md bg-accent px-3.5 py-2.5 text-[15px] text-on-accent opacity-70">{pendingText}</li>}
        {busy && <li role="status" className="self-start text-sm text-muted">{t.health.thinking}</li>}
        <li ref={end} aria-hidden="true" />
      </ul>
      <form onSubmit={submit} className="fixed inset-x-0 bottom-[calc(var(--tabbar-h)_+_env(safe-area-inset-bottom))] z-10 bg-base px-3 pt-2 pb-2">
        <div className="mx-auto flex max-w-xl flex-col gap-1.5">
          {send.isError && <p role="alert" className="px-2 text-sm text-danger">{failure(send.error, t, t.health.chatFailed)}</p>}
          <div className="flex items-end gap-2">
            <label className={`tap raised-sm flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-accent-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${busy ? "opacity-40" : "cursor-pointer"}`}>
              <Icon name="add_a_photo" size={22} />
              <input
                type="file"
                accept="image/*"
                multiple
                aria-label={t.health.attach}
                disabled={busy}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  if (files.length > 0) send.mutate({ words: text.trim(), files });
                }}
                className="sr-only"
              />
            </label>
            <div className="pressed flex min-h-12 flex-1 items-end gap-2 rounded-2xl py-1.5 pr-1.5 pl-3.5">
              <textarea
                aria-label={t.health.message}
                rows={1}
                value={text}
                maxLength={1000}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) submit(event);
                }}
                placeholder={t.health.chatPlaceholder}
                className="field-sizing-content max-h-36 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-base text-ink placeholder:text-muted focus:outline-none"
              />
              <button
                type="submit"
                aria-label={t.health.send}
                disabled={!text.trim() || busy}
                className="tap flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-on-accent disabled:opacity-40"
              >
                <Icon name="arrow_upward" size={20} />
              </button>
            </div>
          </div>
        </div>
      </form>
      {checking && <ReviewSheet read={checking.read} messageId={checking.messageId} onClose={() => setChecking(null)} />}
    </>
  );
}

export function HealthChat() {
  const t = useT();
  return (
    <Screen title={t.health.chatTitle} subtitle={t.health.chatSubtitle} back="/health">
      <WithHealth>{() => <Conversation />}</WithHealth>
    </Screen>
  );
}
