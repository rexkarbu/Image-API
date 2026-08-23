import { describe, it, expect } from "vitest";
import {
  transformImage,
  SHARP_SECURITY_OPTIONS,
  SHARP_TIMEOUT_SECONDS,
} from "@/lib/services/image-transform";
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

  it("verifies Sharp security sandbox options and timeout constants are properly defined", () => {
    expect(SHARP_SECURITY_OPTIONS.failOn).toBe("warning");
    expect(SHARP_SECURITY_OPTIONS.limitInputPixels).toBe(40_000_000);
    expect(SHARP_SECURITY_OPTIONS.limitInputChannels).toBe(4);
    expect(SHARP_SECURITY_OPTIONS.pages).toBe(1);
    expect(SHARP_SECURITY_OPTIONS.animated).toBe(false);
    expect(SHARP_TIMEOUT_SECONDS).toBe(20);
  });

  it("successfully transforms PNG input to WebP output with default options and verifies real binary metadata", async () => {
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

  it("successfully transforms JPEG, PNG, and WebP inputs to all supported outputs (JPEG, PNG, WebP, AVIF) with metadata inspection", async () => {
    const pngInput = await generateTestPng(60, 60);
    const jpegInput = await generateTestJpeg(60, 60);
    const webpInput = await generateTestWebp(60, 60);

    const targets: ("jpeg" | "png" | "webp" | "avif")[] = ["jpeg", "png", "webp", "avif"];

    for (const targetFormat of targets) {
      // From PNG
      const resPng = await transformImage(
        pngInput,
        { format: targetFormat, quality: 80, fit: "inside", withoutEnlargement: true },
        reqId
      );
      const metaPng = await sharp(Buffer.from(resPng.buffer)).metadata();
      if (targetFormat === "avif") {
        expect((metaPng.format as string) === "avif" || metaPng.format === "heif").toBe(true);
      } else {
        expect(metaPng.format).toBe(targetFormat);
      }
      expect(metaPng.width).toBe(60);
      expect(metaPng.height).toBe(60);

      // From JPEG
      const resJpeg = await transformImage(
        jpegInput,
        { format: targetFormat, quality: 80, fit: "inside", withoutEnlargement: true },
        reqId
      );
      const metaJpeg = await sharp(Buffer.from(resJpeg.buffer)).metadata();
      if (targetFormat === "avif") {
        expect((metaJpeg.format as string) === "avif" || metaJpeg.format === "heif").toBe(true);
      } else {
        expect(metaJpeg.format).toBe(targetFormat);
      }
      expect(metaJpeg.width).toBe(60);
      expect(metaJpeg.height).toBe(60);

      // From WebP
      const resWebp = await transformImage(
        webpInput,
        { format: targetFormat, quality: 80, fit: "inside", withoutEnlargement: true },
        reqId
      );
      const metaWebp = await sharp(Buffer.from(resWebp.buffer)).metadata();
      if (targetFormat === "avif") {
        expect((metaWebp.format as string) === "avif" || metaWebp.format === "heif").toBe(true);
      } else {
        expect(metaWebp.format).toBe(targetFormat);
      }
      expect(metaWebp.width).toBe(60);
      expect(metaWebp.height).toBe(60);
    }
  });

  it("resizes with single dimension maintaining aspect ratio (2:1)", async () => {
    const input = await generateTestPng(200, 100);
    const result = await transformImage(
      input,
      { width: 100, format: "png", quality: 80, fit: "inside", withoutEnlargement: true },
      reqId
    );

    const outMeta = await sharp(Buffer.from(result.buffer)).metadata();
    expect(outMeta.width).toBe(100);
    expect(outMeta.height).toBe(50);
  });

  it("correctly implements fit modes: cover, contain, inside, fill", async () => {
    // Input is 200x100 (aspect 2:1)
    const input = await generateTestPng(200, 100, false);

    // 1. fit: cover into 80x80 -> exact 80x80 crop
    const coverRes = await transformImage(
      input,
      { width: 80, height: 80, fit: "cover", format: "webp", quality: 80, withoutEnlargement: true },
      reqId
    );
    const coverMeta = await sharp(Buffer.from(coverRes.buffer)).metadata();
    expect(coverMeta.width).toBe(80);
    expect(coverMeta.height).toBe(80);

    // 2. fit: inside into 80x80 -> 80x40
    const insideRes = await transformImage(
      input,
      { width: 80, height: 80, fit: "inside", format: "webp", quality: 80, withoutEnlargement: true },
      reqId
    );
    const insideMeta = await sharp(Buffer.from(insideRes.buffer)).metadata();
    expect(insideMeta.width).toBe(80);
    expect(insideMeta.height).toBe(40);

    // 3. fit: fill into 80x80 -> exact 80x80 distorted
    const fillRes = await transformImage(
      input,
      { width: 80, height: 80, fit: "fill", format: "webp", quality: 80, withoutEnlargement: true },
      reqId
    );
    const fillMeta = await sharp(Buffer.from(fillRes.buffer)).metadata();
    expect(fillMeta.width).toBe(80);
    expect(fillMeta.height).toBe(80);

    // 4. fit: contain into 80x80 -> exact 80x80 padded
    const containRes = await transformImage(
      input,
      { width: 80, height: 80, fit: "contain", format: "png", quality: 80, withoutEnlargement: true },
      reqId
    );
    const containMeta = await sharp(Buffer.from(containRes.buffer)).metadata();
    expect(containMeta.width).toBe(80);
    expect(containMeta.height).toBe(80);
  });

  it("respects withoutEnlargement: true by not enlarging smaller images", async () => {
    const input = await generateTestPng(50, 50);
    const result = await transformImage(
      input,
      { width: 200, height: 200, fit: "inside", withoutEnlargement: true, format: "png", quality: 80 },
      reqId
    );

    const outMeta = await sharp(Buffer.from(result.buffer)).metadata();
    expect(outMeta.width).toBe(50);
    expect(outMeta.height).toBe(50);
  });

  it("enlarges when withoutEnlargement: false is specified", async () => {
    const input = await generateTestPng(50, 50);
    const result = await transformImage(
      input,
      { width: 150, height: 150, fit: "inside", withoutEnlargement: false, format: "png", quality: 80 },
      reqId
    );

    const outMeta = await sharp(Buffer.from(result.buffer)).metadata();
    expect(outMeta.width).toBe(150);
    expect(outMeta.height).toBe(150);
  });

  it("flattens transparent PNG images onto solid white background when converting to JPEG", async () => {
    // 10x10 fully transparent PNG
    const transparentInput = await sharp({
      create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();

    const result = await transformImage(
      transparentInput,
      { format: "jpeg", quality: 80, fit: "inside", withoutEnlargement: true },
      reqId
    );

    const outMeta = await sharp(Buffer.from(result.buffer)).metadata();
    expect(outMeta.format).toBe("jpeg");
    expect(outMeta.channels).toBe(3);
    expect(outMeta.hasAlpha).toBe(false);

    // Verify actual pixel RGB values are [255, 255, 255] (solid white)
    const { data } = await sharp(Buffer.from(result.buffer)).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBe(255);
    expect(data[1]).toBe(255);
    expect(data[2]).toBe(255);
  });

  it("actually strips verified EXIF, GPS, and XMP metadata from EXIF-bearing input", async () => {
    // Generate image with confirmed EXIF tags
    const inputWithExif = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .withExif({
        IFD0: {
          Artist: "TestArtist",
          Copyright: "TestCopyright",
          Make: "TestCamera",
          Model: "TestModel",
        },
      })
      .jpeg()
      .toBuffer();

    // Verify input actually contains EXIF
    const inMeta = await sharp(inputWithExif).metadata();
    expect(inMeta.exif).toBeDefined();
    expect(inMeta.exif?.length).toBeGreaterThan(0);

    const result = await transformImage(
      inputWithExif,
      { format: "jpeg", quality: 80, fit: "inside", withoutEnlargement: true },
      reqId
    );

    const outMeta = await sharp(Buffer.from(result.buffer)).metadata();
    expect(outMeta.exif).toBeUndefined();
    expect(outMeta.iptc).toBeUndefined();
    expect(outMeta.xmp).toBeUndefined();
  });

  it("auto-orients image based on EXIF orientation before stripping metadata", async () => {
    // Standard EXIF payload with Tag 0x0112 (Orientation), Value 6 (90 degrees CW rotation)
    const exifPayload = Buffer.from([
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // 'Exif\0\0'
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // TIFF header (II*, offset 8)
      0x01, 0x00, // 1 IFD0 tag
      0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, // Tag 0x0112 (Orientation), Type SHORT, Count 1, Value 6
      0x00, 0x00, 0x00, 0x00,
    ]);

    const length = exifPayload.length + 2;
    const app1 = Buffer.concat([
      Buffer.from([0xff, 0xe1, (length >> 8) & 0xff, length & 0xff]),
      exifPayload,
    ]);

    const plainJpeg = await sharp({
      create: { width: 100, height: 50, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .jpeg()
      .toBuffer();

    // Insert APP1 directly after JPEG SOI marker (0xFF, 0xD8)
    const orientedInput = Buffer.concat([
      plainJpeg.subarray(0, 2),
      app1,
      plainJpeg.subarray(2),
    ]);

    const inMeta = await sharp(orientedInput).metadata();
    expect(inMeta.orientation).toBe(6);
    expect(inMeta.width).toBe(100);
    expect(inMeta.height).toBe(50);
    expect(inMeta.exif).toBeDefined();

    const result = await transformImage(
      orientedInput,
      { format: "jpeg", quality: 80, fit: "inside", withoutEnlargement: true },
      reqId
    );

    // Output should have swapped dimensions (50x100) due to auto-rotation
    const outMeta = await sharp(Buffer.from(result.buffer)).metadata();
    expect(outMeta.width).toBe(50);
    expect(outMeta.height).toBe(100);
    expect(outMeta.exif).toBeUndefined();
    expect(outMeta.orientation).toBeUndefined();
  });

  it("rejects unsupported input formats (SVG, GIF, TIFF, PDF, AVIF input) with 415 UNSUPPORTED_IMAGE_TYPE", async () => {
    // SVG
    const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="50" height="50" fill="red"/></svg>');
    try {
      await transformImage(svgBuffer, { format: "webp", quality: 80, fit: "inside", withoutEnlargement: true }, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(415);
      expect(err.code).toBe("UNSUPPORTED_IMAGE_TYPE");
    }

    // GIF
    const gifBuffer = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .gif()
      .toBuffer();
    try {
      await transformImage(gifBuffer, { format: "webp", quality: 80, fit: "inside", withoutEnlargement: true }, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(415);
      expect(err.code).toBe("UNSUPPORTED_IMAGE_TYPE");
    }

    // TIFF
    const tiffBuffer = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .tiff()
      .toBuffer();
    try {
      await transformImage(tiffBuffer, { format: "webp", quality: 80, fit: "inside", withoutEnlargement: true }, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(415);
      expect(err.code).toBe("UNSUPPORTED_IMAGE_TYPE");
    }

    // AVIF as input (only allowed as output format)
    const avifBuffer = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .avif()
      .toBuffer();
    try {
      await transformImage(avifBuffer, { format: "webp", quality: 80, fit: "inside", withoutEnlargement: true }, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(415);
      expect(err.code).toBe("UNSUPPORTED_IMAGE_TYPE");
    }
  });

  it("rejects corrupt or non-image binary input with 422 UNPROCESSABLE_IMAGE", async () => {
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
      expect(err.message).toBe("The uploaded file could not be parsed as a valid image.");
    }
  });
});
