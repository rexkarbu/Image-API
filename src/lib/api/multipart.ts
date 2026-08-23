import "server-only";

import busboy from "busboy";
import { Readable } from "node:stream";
import { ApiError } from "./errors";

export type OutputFormat = "jpeg" | "png" | "webp" | "avif";
export type ImageFit = "cover" | "contain" | "inside" | "fill";

export interface ImageTransformOptions {
  width?: number;
  height?: number;
  format: OutputFormat;
  quality: number;
  fit: ImageFit;
  withoutEnlargement: boolean;
}

export interface ParsedMultipartPayload {
  fileBuffer: Buffer;
  options: ImageTransformOptions;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MiB
const MAX_CONTENT_LENGTH = 15 * 1024 * 1024; // 15 MiB envelope limit
const ALLOWED_FIELDS = new Set(["width", "height", "format", "quality", "fit", "withoutEnlargement"]);
const ALLOWED_FORMATS = new Set<OutputFormat>(["jpeg", "png", "webp", "avif"]);
const ALLOWED_FITS = new Set<ImageFit>(["cover", "contain", "inside", "fill"]);

const GENERIC_MULTIPART_ERROR = "Malformed multipart request payload.";

/**
 * Parses and validates a streaming multipart/form-data request using Busboy.
 * Enforces file size limits, field count limits, single-promise settlement, stream cleanup,
 * and strict options schema validation.
 */
export async function parseMultipartRequest(
  request: Request,
  requestId: string
): Promise<ParsedMultipartPayload> {
  const contentType = request.headers.get("content-type") || request.headers.get("Content-Type");

  if (!contentType || !contentType.toLowerCase().includes("multipart/form-data")) {
    throw new ApiError(
      400,
      "INVALID_MULTIPART",
      "Content-Type must be 'multipart/form-data'.",
      requestId
    );
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const lengthNum = parseInt(contentLength, 10);
    if (!isNaN(lengthNum) && lengthNum > MAX_CONTENT_LENGTH) {
      throw new ApiError(
        413,
        "PAYLOAD_TOO_LARGE",
        "Uploaded payload exceeds maximum allowed size of 10 MiB.",
        requestId
      );
    }
  }

  if (!request.body) {
    throw new ApiError(
      400,
      "INVALID_MULTIPART",
      "Request body is empty.",
      requestId
    );
  }

  return new Promise<ParsedMultipartPayload>((resolve, reject) => {
    let settled = false;
    let nodeReadable: Readable | null = null;
    let bb: busboy.Busboy | null = null;

    const cleanup = () => {
      if (nodeReadable) {
        try {
          if (bb) nodeReadable.unpipe(bb);
          nodeReadable.destroy();
        } catch {}
      }
      if (bb) {
        try {
          bb.removeAllListeners();
          bb.on("error", () => {});
        } catch {}
      }
    };

    const fail = (err: ApiError) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
      }
    };

    const succeed = (payload: ParsedMultipartPayload) => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(payload);
      }
    };

    // Check early abort
    if (request.signal?.aborted) {
      return fail(new ApiError(400, "INVALID_MULTIPART", "Client aborted the request.", requestId));
    }

    const abortHandler = () => {
      fail(new ApiError(400, "INVALID_MULTIPART", "Client aborted the request.", requestId));
    };

    if (request.signal) {
      request.signal.addEventListener("abort", abortHandler, { once: true });
    }

    try {
      bb = busboy({
        headers: { "content-type": contentType },
        limits: {
          fileSize: MAX_FILE_SIZE,
          files: 1,
          fields: 6,
          parts: 8,
          fieldSize: 1024,
        },
      });
    } catch {
      return fail(
        new ApiError(400, "INVALID_MULTIPART", "Malformed multipart boundary or headers.", requestId)
      );
    }

    let fileFound = false;
    let fileTruncated = false;
    const fileChunks: Buffer[] = [];
    let fileSizeBytes = 0;
    const rawFields: Record<string, string> = {};
    const seenFields = new Set<string>();

    bb.on("file", (fieldname, stream) => {
      if (fieldname !== "file" || fileFound) {
        stream.resume(); // Discard stream
        return fail(
          new ApiError(
            400,
            "INVALID_MULTIPART",
            "Exactly one image file must be uploaded under the 'file' field.",
            requestId
          )
        );
      }

      fileFound = true;

      stream.on("data", (chunk: Buffer) => {
        fileSizeBytes += chunk.length;
        if (fileSizeBytes > MAX_FILE_SIZE) {
          fileTruncated = true;
        } else {
          fileChunks.push(chunk);
        }
      });

      stream.on("limit", () => {
        fileTruncated = true;
      });

      stream.on("error", () => {
        fail(new ApiError(400, "INVALID_MULTIPART", GENERIC_MULTIPART_ERROR, requestId));
      });
    });

    bb.on("field", (name, val) => {
      if (!ALLOWED_FIELDS.has(name)) {
        return fail(
          new ApiError(
            400,
            "INVALID_OPTIONS",
            `Unknown multipart field: '${name}'.`,
            requestId
          )
        );
      }

      if (seenFields.has(name)) {
        return fail(
          new ApiError(
            400,
            "INVALID_MULTIPART",
            `Duplicate multipart field: '${name}'.`,
            requestId
          )
        );
      }

      seenFields.add(name);
      rawFields[name] = val;
    });

    bb.on("filesLimit", () => {
      fail(
        new ApiError(
          400,
          "INVALID_MULTIPART",
          "Only exactly one image file is allowed per request.",
          requestId
        )
      );
    });

    bb.on("fieldsLimit", () => {
      fail(
        new ApiError(
          400,
          "INVALID_MULTIPART",
          "Exceeded maximum number of multipart fields.",
          requestId
        )
      );
    });

    bb.on("partsLimit", () => {
      fail(
        new ApiError(
          400,
          "INVALID_MULTIPART",
          "Exceeded maximum number of multipart parts.",
          requestId
        )
      );
    });

    bb.on("error", () => {
      fail(
        new ApiError(
          400,
          "INVALID_MULTIPART",
          GENERIC_MULTIPART_ERROR,
          requestId
        )
      );
    });

    bb.on("finish", () => {
      if (settled) return;

      if (!fileFound || fileChunks.length === 0) {
        return fail(
          new ApiError(
            400,
            "INVALID_MULTIPART",
            "Missing required image file under 'file' field.",
            requestId
          )
        );
      }

      if (fileTruncated || fileSizeBytes > MAX_FILE_SIZE) {
        return fail(
          new ApiError(
            413,
            "PAYLOAD_TOO_LARGE",
            "Uploaded image exceeds maximum allowed size of 10 MiB.",
            requestId
          )
        );
      }

      // Validate Options
      try {
        const options = parseAndValidateOptions(rawFields, requestId);
        const fileBuffer = Buffer.concat(fileChunks);
        succeed({ fileBuffer, options });
      } catch (err) {
        fail(err as ApiError);
      }
    });

    // Pipe the web ReadableStream into Node busboy
    try {
      nodeReadable = Readable.fromWeb(request.body as import("stream/web").ReadableStream);
      nodeReadable.on("error", () => {
        fail(new ApiError(400, "INVALID_MULTIPART", GENERIC_MULTIPART_ERROR, requestId));
      });
      nodeReadable.pipe(bb);
    } catch {
      fail(new ApiError(400, "INVALID_MULTIPART", GENERIC_MULTIPART_ERROR, requestId));
    }
  });
}

function parseAndValidateOptions(
  fields: Record<string, string>,
  requestId: string
): ImageTransformOptions {
  let width: number | undefined;
  let height: number | undefined;
  let format: OutputFormat = "webp";
  let quality = 80;
  let fit: ImageFit = "inside";
  let withoutEnlargement = true;

  // 1. Width validation
  if (fields.width !== undefined) {
    const rawW = fields.width.trim();
    if (!/^\d+$/.test(rawW)) {
      throw new ApiError(400, "INVALID_OPTIONS", "Width must be an integer between 1 and 4096.", requestId);
    }
    const numW = parseInt(rawW, 10);
    if (numW < 1 || numW > 4096) {
      throw new ApiError(400, "INVALID_OPTIONS", "Width must be between 1 and 4096 pixels.", requestId);
    }
    width = numW;
  }

  // 2. Height validation
  if (fields.height !== undefined) {
    const rawH = fields.height.trim();
    if (!/^\d+$/.test(rawH)) {
      throw new ApiError(400, "INVALID_OPTIONS", "Height must be an integer between 1 and 4096.", requestId);
    }
    const numH = parseInt(rawH, 10);
    if (numH < 1 || numH > 4096) {
      throw new ApiError(400, "INVALID_OPTIONS", "Height must be between 1 and 4096 pixels.", requestId);
    }
    height = numH;
  }

  // 3. Format validation
  if (fields.format !== undefined) {
    const rawF = fields.format.trim().toLowerCase() as OutputFormat;
    if (!ALLOWED_FORMATS.has(rawF)) {
      throw new ApiError(
        400,
        "INVALID_OPTIONS",
        `Invalid output format '${fields.format}'. Allowed: jpeg, png, webp, avif.`,
        requestId
      );
    }
    format = rawF;
  }

  // 4. Quality validation
  if (fields.quality !== undefined) {
    if (format === "png") {
      throw new ApiError(
        400,
        "INVALID_OPTIONS",
        "Quality parameter is not supported for PNG format (PNG uses lossless compression).",
        requestId
      );
    }

    const rawQ = fields.quality.trim();
    if (!/^\d+$/.test(rawQ)) {
      throw new ApiError(400, "INVALID_OPTIONS", "Quality must be an integer between 1 and 100.", requestId);
    }
    const numQ = parseInt(rawQ, 10);
    if (numQ < 1 || numQ > 100) {
      throw new ApiError(400, "INVALID_OPTIONS", "Quality must be between 1 and 100.", requestId);
    }
    quality = numQ;
  }

  // 5. Fit validation: only valid when BOTH width and height are provided
  if (fields.fit !== undefined) {
    if (fields.width === undefined || fields.height === undefined) {
      throw new ApiError(
        400,
        "INVALID_OPTIONS",
        "The 'fit' parameter is only allowed when both 'width' and 'height' dimensions are provided.",
        requestId
      );
    }

    const rawFit = fields.fit.trim().toLowerCase() as ImageFit;
    if (!ALLOWED_FITS.has(rawFit)) {
      throw new ApiError(
        400,
        "INVALID_OPTIONS",
        `Invalid fit parameter '${fields.fit}'. Allowed: cover, contain, inside, fill.`,
        requestId
      );
    }
    fit = rawFit;
  }

  // 6. withoutEnlargement validation
  if (fields.withoutEnlargement !== undefined) {
    const rawWE = fields.withoutEnlargement.trim().toLowerCase();
    if (rawWE === "true" || rawWE === "1") {
      withoutEnlargement = true;
    } else if (rawWE === "false" || rawWE === "0") {
      withoutEnlargement = false;
    } else {
      throw new ApiError(
        400,
        "INVALID_OPTIONS",
        "withoutEnlargement must be a boolean ('true' or 'false').",
        requestId
      );
    }
  }

  return {
    width,
    height,
    format,
    quality,
    fit,
    withoutEnlargement,
  };
}
