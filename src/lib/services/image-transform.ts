import sharp, { type Metadata, type SharpOptions } from "sharp";
import { ImageTransformOptions, OutputFormat } from "@/lib/api/multipart";
import { ApiError } from "@/lib/api/errors";

export interface TransformResult {
  buffer: Uint8Array;
  contentType: string;
  format: OutputFormat;
  width: number;
  height: number;
  sizeBytes: number;
}

export const SHARP_SECURITY_OPTIONS: SharpOptions = {
  failOn: "warning",
  limitInputPixels: 40_000_000,
  limitInputChannels: 4,
  pages: 1,
  animated: false,
};

export const SHARP_TIMEOUT_SECONDS = 20;
const MAX_OUTPUT_SIZE = 20 * 1024 * 1024; // 20 MiB
const ALLOWED_INPUT_FORMATS = new Set(["jpeg", "png", "webp"]);

const CONTENT_TYPES: Record<OutputFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

/**
 * Transforms an untrusted image buffer using Sharp with strict security sandboxing.
 * Strips all metadata, applies auto-orientation, resizes within boundaries, enforces 20s timeout,
 * and converts to target format with sanitized public error mapping.
 */
export async function transformImage(
  inputBuffer: Buffer,
  options: ImageTransformOptions,
  requestId: string
): Promise<TransformResult> {
  // 1. Initial metadata inspection & format gating with shared security options
  let metadata: Metadata;
  try {
    const probe = sharp(inputBuffer, SHARP_SECURITY_OPTIONS);
    metadata = await probe.metadata();
  } catch {
    throw new ApiError(
      422,
      "UNPROCESSABLE_IMAGE",
      "The uploaded file could not be parsed as a valid image.",
      requestId
    );
  }

  if (!metadata.format || !ALLOWED_INPUT_FORMATS.has(metadata.format)) {
    throw new ApiError(
      415,
      "UNSUPPORTED_IMAGE_TYPE",
      `Unsupported image format '${metadata.format || "unknown"}'. Only JPEG, PNG, and WebP inputs are accepted.`,
      requestId
    );
  }

  // Reject animated WebP or multi-page documents
  if (metadata.pages && metadata.pages > 1) {
    throw new ApiError(
      415,
      "UNSUPPORTED_IMAGE_TYPE",
      "Animated or multi-page images are not supported.",
      requestId
    );
  }

  // 2. Build secure Sharp transformation pipeline
  try {
    let pipeline = sharp(inputBuffer, SHARP_SECURITY_OPTIONS)
      .timeout({ seconds: SHARP_TIMEOUT_SECONDS });

    // Auto-orient based on EXIF before stripping metadata / resizing
    pipeline = pipeline.rotate();

    // Apply Resize if dimensions requested
    if (options.width || options.height) {
      pipeline = pipeline.resize({
        width: options.width,
        height: options.height,
        fit: options.fit,
        withoutEnlargement: options.withoutEnlargement,
      });
    }

    // For JPEG output, always flatten alpha/padding against solid white
    if (options.format === "jpeg") {
      pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } });
    }

    // Apply safe format encoder options (metadata stripped by default as keepMetadata is omitted)
    switch (options.format) {
      case "jpeg":
        pipeline = pipeline.jpeg({
          quality: options.quality,
          mozjpeg: true,
        });
        break;
      case "png":
        pipeline = pipeline.png({
          compressionLevel: 9,
          adaptiveFiltering: true,
        });
        break;
      case "webp":
        pipeline = pipeline.webp({
          quality: options.quality,
          effort: 4,
        });
        break;
      case "avif":
        pipeline = pipeline.avif({
          quality: options.quality,
          effort: 4,
        });
        break;
    }

    // 3. Execute transformation with timeout
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

    // 4. Validate output bounds
    if (data.length > MAX_OUTPUT_SIZE) {
      throw new ApiError(
        413,
        "PAYLOAD_TOO_LARGE",
        "Transformed image output exceeds maximum allowable size (20 MiB).",
        requestId
      );
    }

    if (info.width > 4096 || info.height > 4096) {
      throw new ApiError(
        422,
        "UNPROCESSABLE_IMAGE",
        "Generated image dimensions exceed maximum allowable limits (4096x4096).",
        requestId
      );
    }

    return {
      buffer: new Uint8Array(data),
      contentType: CONTENT_TYPES[options.format],
      format: options.format,
      width: info.width,
      height: info.height,
      sizeBytes: data.length,
    };
  } catch (err) {
    if (err instanceof ApiError) throw err;

    // Log internally with only operation and correlation ID without leaking libvips error strings
    console.error(`[Image Processing Error] operation=transformImage correlationId=${requestId}`);
    throw new ApiError(
      422,
      "UNPROCESSABLE_IMAGE",
      "Failed to process and encode the image with the specified options.",
      requestId
    );
  }
}
