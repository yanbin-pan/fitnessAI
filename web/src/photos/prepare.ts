// Photos are fitted within 1568 px and re-encoded as JPEG on the phone (spec §6.5): uploads stay
// at a few hundred kilobytes, and the re-encode drops the EXIF metadata, location included.

export const MAX_EDGE = 1568;
export const JPEG_QUALITY = 0.85;

/** The size that fits within `maxEdge` on the long edge, keeping the shape and never enlarging. */
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function preparePhoto(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    // Decoding applies the photo's EXIF orientation, so the drawing below comes out upright.
    await image.decode();
    const { width, height } = fitWithin(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser can't draw the photo");
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) throw new Error("This browser can't encode the photo");
    return { blob, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
