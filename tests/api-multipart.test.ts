import { describe, it, expect } from "vitest";
import { parseMultipartRequest } from "@/lib/api/multipart";
import { ApiError } from "@/lib/api/errors";
import sharp from "sharp";

async function createDummyImage(): Promise<Buffer> {
  return await sharp({
    create: {
      width: 10,
      height: 10,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();
}

function buildMultipartRequest(
  fields: Record<string, string | null>,
  fileBuffer?: Buffer,
  fileName = "test.png",
  fieldName = "file"
): Request {
  const boundary = "---------------------------974767299852498929531610575";
  const chunks: Buffer[] = [];

  for (const [key, val] of Object.entries(fields)) {
    if (val !== null) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`
        )
      );
    }
  }

  if (fileBuffer) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\nContent-Type: image/png\r\n\r\n`
      )
    );
    chunks.push(fileBuffer);
    chunks.push(Buffer.from("\r\n"));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const fullBody = Buffer.concat(chunks);

  return new Request("http://localhost:3000/v1/images/transform", {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(fullBody.length),
    },
    body: fullBody,
  });
}

describe("Streaming Multipart Parser & Options Validator Unit Tests", () => {
  const reqId = "req-multi-1234";

  it("parses valid multipart request with default options", async () => {
    const dummy = await createDummyImage();
    const req = buildMultipartRequest({}, dummy);

    const parsed = await parseMultipartRequest(req, reqId);
    expect(parsed.fileBuffer).toBeInstanceOf(Buffer);
    expect(parsed.fileBuffer.length).toBe(dummy.length);
    expect(parsed.options.format).toBe("webp");
    expect(parsed.options.quality).toBe(80);
    expect(parsed.options.fit).toBe("inside");
    expect(parsed.options.withoutEnlargement).toBe(true);
  });

  it("parses explicit valid options: width, height, format, quality, fit, withoutEnlargement", async () => {
    const dummy = await createDummyImage();
    const req = buildMultipartRequest(
      {
        width: "500",
        height: "300",
        format: "jpeg",
        quality: "90",
        fit: "cover",
        withoutEnlargement: "false",
      },
      dummy
    );

    const parsed = await parseMultipartRequest(req, reqId);
    expect(parsed.options.width).toBe(500);
    expect(parsed.options.height).toBe(300);
    expect(parsed.options.format).toBe("jpeg");
    expect(parsed.options.quality).toBe(90);
    expect(parsed.options.fit).toBe("cover");
    expect(parsed.options.withoutEnlargement).toBe(false);
  });

  it("rejects non-multipart Content-Type with 400 INVALID_MULTIPART", async () => {
    const req = new Request("http://localhost:3000/v1/images/transform", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ width: 100 }),
    });

    try {
      await parseMultipartRequest(req, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("INVALID_MULTIPART");
    }
  });

  it("rejects request without uploaded file with 400 INVALID_MULTIPART", async () => {
    const req = buildMultipartRequest({ width: "100" });

    try {
      await parseMultipartRequest(req, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("INVALID_MULTIPART");
      expect(err.message).toContain("Missing required image file");
    }
  });

  it("rejects unknown multipart field with 400 INVALID_OPTIONS", async () => {
    const dummy = await createDummyImage();
    const req = buildMultipartRequest({ unknownParam: "value" }, dummy);

    try {
      await parseMultipartRequest(req, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("INVALID_OPTIONS");
      expect(err.message).toContain("Unknown multipart field");
    }
  });

  it("rejects duplicate multipart field with 400 INVALID_MULTIPART", async () => {
    const dummy = await createDummyImage();
    const boundary = "---------------------------974767299852498929531610575";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="width"\r\n\r\n100\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="width"\r\n\r\n200\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n`),
      dummy,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const req = new Request("http://localhost:3000/v1/images/transform", {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    });

    try {
      await parseMultipartRequest(req, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("INVALID_MULTIPART");
      expect(err.message).toContain("Duplicate multipart field");
    }
  });

  it("rejects quality parameter when format=png with 400 INVALID_OPTIONS", async () => {
    const dummy = await createDummyImage();
    const req = buildMultipartRequest({ format: "png", quality: "85" }, dummy);

    try {
      await parseMultipartRequest(req, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("INVALID_OPTIONS");
      expect(err.message).toContain("Quality parameter is not supported for PNG");
    }
  });

  it("rejects invalid dimensions: width < 1 or width > 4096 or non-integer", async () => {
    const dummy = await createDummyImage();

    for (const invalidW of ["0", "4097", "-10", "abc", "100.5"]) {
      const req = buildMultipartRequest({ width: invalidW }, dummy);
      await expect(parseMultipartRequest(req, reqId)).rejects.toThrow(ApiError);
    }
  });

  it("rejects invalid format with 400 INVALID_OPTIONS", async () => {
    const dummy = await createDummyImage();
    const req = buildMultipartRequest({ format: "gif" }, dummy);

    try {
      await parseMultipartRequest(req, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("INVALID_OPTIONS");
      expect(err.message).toContain("Invalid output format");
    }
  });

  it("rejects invalid fit with 400 INVALID_OPTIONS", async () => {
    const dummy = await createDummyImage();
    const req = buildMultipartRequest({ fit: "invalid_fit" }, dummy);

    try {
      await parseMultipartRequest(req, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("INVALID_OPTIONS");
      expect(err.message).toContain("Invalid fit parameter");
    }
  });

  it("rejects file exceeding 10 MiB with 413 PAYLOAD_TOO_LARGE", async () => {
    // 10.5 MiB buffer
    const oversizedBuffer = Buffer.alloc(10.5 * 1024 * 1024);
    const req = buildMultipartRequest({}, oversizedBuffer);

    try {
      await parseMultipartRequest(req, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(413);
      expect(err.code).toBe("PAYLOAD_TOO_LARGE");
    }
  });
});
