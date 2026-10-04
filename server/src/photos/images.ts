// What a file is and how big it is, read from its own bytes (spec §6.5): the type a request
// declares is never trusted.

export type ImageType = "image/jpeg" | "image/png";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function detectImageType(buf: Uint8Array): ImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && PNG_SIGNATURE.every((byte, i) => buf[i] === byte)) return "image/png";
  return null;
}

export function extensionFor(type: ImageType): "jpg" | "png" {
  return type === "image/jpeg" ? "jpg" : "png";
}

function positive(width: number, height: number): { width: number; height: number } | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Width and height from PNG's IHDR chunk or a JPEG's start-of-frame segment; null when there is none. */
export function imageSize(buf: Uint8Array, type: ImageType): { width: number; height: number } | null {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (type === "image/png") {
    // Signature (8 bytes), chunk length (4), "IHDR" (4), then width and height.
    if (buf.length < 24 || String.fromCharCode(...buf.subarray(12, 16)) !== "IHDR") return null;
    return positive(view.getUint32(16), view.getUint32(20));
  }
  let offset = 2; // after SOI
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) return null;
    const marker = buf[offset + 1];
    if (marker === 0xff) {
      offset += 1; // a fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2; // markers without a length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // the image ended, or its data began, before any frame
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      // FF Cn, length (2), precision (1), height (2), width (2)
      if (offset + 9 > buf.length) return null;
      return positive(view.getUint16(offset + 7), view.getUint16(offset + 5));
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return null;
}
