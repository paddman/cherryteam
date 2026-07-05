import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import type { ImageContentPart, VisionAttachment } from "./types.js";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function attachmentToImagePart(
  attachment: VisionAttachment,
): Promise<ImageContentPart> {
  if (attachment.url) {
    return {
      type: "image_url",
      image_url: { url: attachment.url, detail: "auto" },
    };
  }

  if (!attachment.path) {
    throw new Error("Vision attachment requires either url or path");
  }

  const bytes = await readFile(attachment.path);
  const mimeType =
    attachment.mimeType ??
    MIME_BY_EXTENSION[extname(attachment.path).toLowerCase()] ??
    "application/octet-stream";

  return {
    type: "image_url",
    image_url: {
      url: `data:${mimeType};base64,${bytes.toString("base64")}`,
      detail: "auto",
    },
  };
}
