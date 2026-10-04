import type Anthropic from "@anthropic-ai/sdk";
import type { AiMessage } from "../ai/client.ts";
import type { PhotoData } from "../photos/photos.ts";

// A stored user turn keeps a small reference per photo instead of the image (spec §5, §6.5).
// Every replay turns it back into the identical image block — built by the same function
// as the first send — so the day's prompt cache and its thinking blocks stay valid.

export const PHOTO_REF = "photo_ref";
/** The text of a message sent with photos and no words. */
export const PHOTOS_ONLY_TEXT = "(no text, only the photos above)";
/** What a replayed photo becomes once its file has gone. */
export const MISSING_PHOTO_TEXT = "[photo no longer available]";

export interface PhotoRefBlock {
  type: typeof PHOTO_REF;
  photo_id: string;
}

export function photoRef(id: string): PhotoRefBlock {
  return { type: PHOTO_REF, photo_id: id };
}

export function imageBlock(photo: PhotoData): Anthropic.Beta.BetaImageBlockParam {
  return { type: "image", source: { type: "base64", media_type: photo.media_type, data: photo.data } };
}

function isPhotoRef(block: unknown): block is PhotoRefBlock {
  return typeof block === "object" && block !== null && (block as { type?: unknown }).type === PHOTO_REF;
}

/** Turns stored photo references back into image blocks; a photo that has gone becomes a short note. */
export function hydrateTurns(turns: AiMessage[], load: (id: string) => PhotoData | null): AiMessage[] {
  return turns.map((turn) => {
    if (typeof turn.content === "string") return turn;
    const blocks = turn.content as unknown[];
    if (!blocks.some(isPhotoRef)) return turn;
    const content = blocks.map((block) => {
      if (!isPhotoRef(block)) return block;
      const photo = load(block.photo_id);
      return photo ? imageBlock(photo) : { type: "text", text: MISSING_PHOTO_TEXT };
    });
    return { ...turn, content: content as AiMessage["content"] };
  });
}
