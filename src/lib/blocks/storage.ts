import { blocksClient } from "./client";
import { blocksDataCall } from "./http";

/**
 * Product image upload via the Blocks Storage service — presign, PUT the bytes, then read
 * back the servable URL. Per the `blocks-data-storage` skill: cloud presign creates the
 * file's metadata/version before the provider PUT, so a failed PUT can leave metadata for
 * missing bytes; surfaced as a thrown error either way rather than silently swallowed.
 *
 * `accessModifier: "Public"` is deliberate — product images need to render on the
 * unauthenticated storefront, the same reason `Product`/`Category` reads are public on the
 * Data Gateway.
 *
 * The platform itself enforces no upload size limit or content verification
 * (`DATA_GATEWAY_STORAGE_FEATURES_AND_SECURITY.md` items A5/A6) — the size/type check below
 * is a client-side courtesy for this form only, not a substitute for that.
 */

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export class ImageValidationError extends Error {}

export interface UploadedImage {
  fileId: string;
  url: string;
}

function assertValidImage(file: File): void {
  if (!file.type.startsWith("image/")) {
    throw new ImageValidationError("Please choose an image file.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ImageValidationError(`Image is too large (max ${MAX_IMAGE_BYTES / (1024 * 1024)} MB).`);
  }
}

interface PresignResponse {
  uploadUrl?: string;
  fileId?: string;
  isSuccess?: boolean;
  errors?: Record<string, string>;
}

interface FileGetResponse {
  url?: string;
  isSuccess?: boolean;
}

export async function uploadPublicImage(file: File): Promise<UploadedImage> {
  assertValidImage(file);

  const presign = (await blocksDataCall(() =>
    blocksClient.data.files.presignedUploadUrl({
      name: file.name,
      accessModifier: "Public",
    })
  )) as PresignResponse;

  if (!presign.isSuccess || !presign.uploadUrl || !presign.fileId) {
    throw new Error(presign.errors ? Object.values(presign.errors).join("; ") : "Could not start the upload.");
  }

  // Direct provider PUT — never send Blocks auth/x-blocks-key here (per the storage skill).
  await blocksClient.data.files.uploadToUrl({
    url: presign.uploadUrl,
    body: file,
    contentType: file.type || "application/octet-stream",
  });

  const fileId = presign.fileId;
  const fileRecord = (await blocksDataCall(() => blocksClient.data.files.get(fileId))) as FileGetResponse;
  if (!fileRecord.url) {
    throw new Error("Upload finished, but no accessible URL was returned yet.");
  }

  return { fileId, url: fileRecord.url };
}

// Existing product forms keep their domain-specific name; storefront content uses the
// same public-image upload path because both assets must render for signed-out visitors.
export const uploadProductImage = uploadPublicImage;
