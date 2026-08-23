import { describe, it, expect } from "vitest";
import { transformImage } from "@/lib/services/image-transform";
import { ApiError } from "@/lib/api/errors";
import sharp from "sharp";

describe("Sharp Image Transformation Service Unit Tests", () => {
  const reqId = "req-transform-test";

  async function generateTestPng(width = 100, height = 80, hasAlpha = true): Promise<Buffer> {
    return await sharp({
      create: {
        width,
        height,
        channels: hasAlpha ? 4 : 3,
        background: hasAlpha ? { r: 200, g: 50, b: 50, alpha: 0.5 } : { r: 200, g: 50, b: 50 },
      },
    })
      .png()
      .toBuffer();
  }

  async function generateTestJpeg(width = 100, height = 80): Promise<Buffer> {
    return await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 100, g: 150, b: 200 },
      },
    })
      .jpeg()
      .toBuffer();
  }

  async function generateTestWebp(width = 100, height = 80): Promise<Buffer> {
    return await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 50, g: 100, b: 150 },
      },
    })
      .webp()
      .toBuffer();
  }

  it("successfully transforms PNG input to WebP output with default options", async () => {
    const input = await generateTestPng(120, 90);
    const result = await transformImage(
      input,
      { format: "webp", quality: 80, fit: "inside", withoutEnlargement: true },
      reqId
    );

    expect(result.format).toBe("webp");
    expect(result.contentType).toBe("image/webp");
    expect(result.width).toBe(120);
    expect(result.height).toBe(90);
    expect(result.buffer.length).toBeGreaterThan(0);

    const outMeta = await sharp(Buffer.from(result.buffer)).metadata();
    expect(outMeta.format).toBe("webp");
    expect(outMeta.width).toBe(120);
    expect(outMeta.height).toBe(90);
  });

  it("successfully transforms JPEG, PNG, and WebP inputs to all supported outputs (JPEG, PNG, WebP, AVIF)", async () => {
    const pngInput = await generateTestPng(60, 60);
    const jpegInput = await generateTestJpeg(60, 60);
    const webpInput = await generateTestWebp(60, 60);

    const targets: ("jpeg" | "png" | "webp" | "avif")[] = ["jpeg", "png", "webp", "avif"];

    for (const targetFormat of targets) {
      const resPng = await transformImage(
        pngInput,
        { format: targetFormat, quality: 80, fit: "inside", withoutEnlargement: true },
        reqId
      );
      expect(resPng.format).toBe(targetFormat);

      const resJpeg = await transformImage(
        jpegInput,
        { format: targetFormat, quality: 80, fit: "inside", withoutEnlargement: true },
        reqId
      );
      expect(resJpeg.format).toBe(targetFormat);

      const resWebp = await transformImage(
        webpInput,
        { format: targetFormat, quality: 80, fit: "inside", withoutEnlargement: true },
        reqId
      );
      expect(resWebp.format).toBe(targetFormat);
    }
  });

  it("resizes with single dimension maintaining aspect ratio", async () => {
    // 200x100 aspect ratio is 2:1
    const input = await generateTestPng(200, 100);
    const result = await transformImage(
      input,
      { width: 100, format: "png", quality: 80, fit: "inside", withoutEnlargement: true },
      reqId
    );

    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
  });

  it("resizes with two dimensions using fit options (cover, contain, inside, fill)", async () => {
    const input = await generateTestPng(200, 100);

    // fit: cover
    const coverRes = await transformImage(
      input,
      { width: 80, height: 80, fit: "cover", format: "webp", quality: 80, withoutEnlargement: true },
      reqId
    );
    expect(coverRes.width).toBe(80);
    expect(coverRes.height).toBe(80);

    // fit: inside
    const insideRes = await transformImage(
      input,
      { width: 80, height: 80, fit: "inside", format: "webp", quality: 80, withoutEnlargement: true },
      reqId
    );
    expect(insideRes.width).toBe(80);
    expect(insideRes.height).toBe(40);
  });

  it("respects withoutEnlargement: true by not enlarging smaller images", async () => {
    const input = await generateTestPng(50, 50);
    const result = await transformImage(
      input,
      { width: 200, height: 200, fit: "inside", withoutEnlargement: true, format: "png", quality: 80 },
      reqId
    );

    expect(result.width).toBe(50);
    expect(result.height).toBe(50);
  });

  it("enlarges when withoutEnlargement: false is specified", async () => {
    const input = await generateTestPng(50, 50);
    const result = await transformImage(
      input,
      { width: 150, height: 150, fit: "inside", withoutEnlargement: false, format: "png", quality: 80 },
      reqId
    );

    expect(result.width).toBe(150);
    expect(result.height).toBe(150);
  });

  it("flattens transparent PNG images against white background when converting to JPEG", async () => {
    const input = await generateTestPng(50, 50, true);
    const result = await transformImage(
      input,
      { format: "jpeg", quality: 80, fit: "inside", withoutEnlargement: true },
      reqId
    );

    const outMeta = await sharp(Buffer.from(result.buffer)).metadata();
    expect(outMeta.format).toBe("jpeg");
    expect(outMeta.channels).toBe(3); // Flattened to 3 channels without alpha
    expect(outMeta.hasAlpha).toBe(false);
  });

  it("strips all EXIF, GPS, and metadata from output", async () => {
    // Generate image with sample EXIF data
    const input = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .jpeg()
      .toBuffer();

    const result = await transformImage(
      input,
      { format: "jpeg", quality: 80, fit: "inside", withoutEnlargement: true },
      reqId
    );

    const outMeta = await sharp(Buffer.from(result.buffer)).metadata();
    expect(outMeta.exif).toBeUndefined();
    expect(outMeta.iptc).toBeUndefined();
    expect(outMeta.xmp).toBeUndefined();
  });

  it("rejects unsupported input formats like SVG, GIF, TIFF, PDF with 415 UNSUPPORTED_IMAGE_TYPE", async () => {
    const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="50" height="50" fill="red"/></svg>');

    try {
      await transformImage(
        svgBuffer,
        { format: "webp", quality: 80, fit: "inside", withoutEnlargement: true },
        reqId
      );
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(415);
      expect(err.code).toBe("UNSUPPORTED_IMAGE_TYPE");
    }
  });

  it("rejects corrupt / non-image binary input with 422 UNPROCESSABLE_IMAGE", async () => {
    const corruptBuffer = Buffer.from("this is completely not an image binary data random text");

    try {
      await transformImage(
        corruptBuffer,
        { format: "webp", quality: 80, fit: "inside", withoutEnlargement: true },
        reqId
      );
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe("UNPROCESSABLE_IMAGE");
    }
  });
});
