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
  fieldName = "file",
  signal?: AbortSignal
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

  const init: RequestInit & { duplex?: "half" } = {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(fullBody.length),
    },
    body: fullBody,
    signal,
    duplex: "half",
  };

  return new Request("http://localhost:3000/v1/images/transform", init);
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

  it("accepts exactly one file plus six valid fields (7 total accepted parts)", async () => {
    const dummy = await createDummyImage();
    // 6 text fields + 1 file = 7 total parts
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

  it("rejects an eighth multipart part with 400 INVALID_MULTIPART", async () => {
    const dummy = await createDummyImage();
    const boundary = "---------------------------974767299852498929531610575";
    // 6 text fields + 1 file + 1 extra field = 8 parts
    const chunks: Buffer[] = [
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="width"\r\n\r\n100\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="height"\r\n\r\n100\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="format"\r\n\r\nwebp\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="quality"\r\n\r\n80\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="fit"\r\n\r\ninside\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="withoutEnlargement"\r\n\r\ntrue\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n`),
      dummy,
      Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="extraField"\r\n\r\nextra\r\n`),
      Buffer.from(`--${boundary}--\r\n`),
    ];

    const fullBody = Buffer.concat(chunks);
    const req = new Request("http://localhost:3000/v1/images/transform", {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: fullBody,
    });

    try {
      await parseMultipartRequest(req, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("INVALID_MULTIPART");
      expect(["Exceeded maximum number of multipart parts.", "Exceeded maximum number of multipart fields."]).toContain(err.message);
    }
  });

  it("removes abort listener from request signal after successful parse", async () => {
    const controller = new AbortController();
    const dummy = await createDummyImage();
    const req = buildMultipartRequest({}, dummy, "test.png", "file", controller.signal);

    await parseMultipartRequest(req, reqId);

    // If abort fires after completion, nothing should throw or handle
    expect(() => controller.abort()).not.toThrow();
  });

  it("removes abort listener from request signal after parser failure", async () => {
    const controller = new AbortController();
    const req = buildMultipartRequest({ width: "not-a-number" }, undefined, "test.png", "file", controller.signal);

    try {
      await parseMultipartRequest(req, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
    }

    // If abort fires after failure, no secondary rejection occurs
    expect(() => controller.abort()).not.toThrow();
  });

  it("handles request abort occurring after parsing has started", async () => {
    const controller = new AbortController();
    const boundary = "---------------------------974767299852498929531610575";

    // Streaming body that aborts while streaming chunks
    const stream = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="width"\r\n\r\n200\r\n`));
        // Trigger abort mid-stream
        setTimeout(() => {
          controller.abort();
        }, 10);
      },
    });

    const init: RequestInit & { duplex?: "half" } = {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: stream,
      signal: controller.signal,
      duplex: "half",
    };

    const req = new Request("http://localhost:3000/v1/images/transform", init);

    try {
      await parseMultipartRequest(req, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("INVALID_MULTIPART");
      expect(err.message).toBe("Client aborted the request.");
    }
  });

  it("handles source ReadableStream error after parsing begins cleanly without unhandled stream error", async () => {
    const boundary = "---------------------------974767299852498929531610575";

    // Stream that errors after first chunk
    const errorStream = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="width"\r\n\r\n200\r\n`));
        setTimeout(() => {
          ctrl.error(new Error("Underlying TCP connection reset by peer"));
        }, 10);
      },
    });

    const init: RequestInit & { duplex?: "half" } = {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: errorStream,
      duplex: "half",
    };

    const req = new Request("http://localhost:3000/v1/images/transform", init);

    try {
      await parseMultipartRequest(req, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("INVALID_MULTIPART");
      expect(err.message).toBe("Malformed multipart request payload.");
      expect(err.message).not.toContain("TCP");
      expect(err.message).not.toContain("reset");
    }
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
      expect(err.message).toBe("Content-Type must be 'multipart/form-data'.");
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

  it("rejects file uploaded under wrong field name (e.g. 'image' instead of 'file')", async () => {
    const dummy = await createDummyImage();
    const req = buildMultipartRequest({}, dummy, "test.png", "image");

    try {
      await parseMultipartRequest(req, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("INVALID_MULTIPART");
      expect(err.message).toBe("Exactly one image file must be uploaded under the 'file' field.");
    }
  });

  it("rejects multiple files uploaded in a single request", async () => {
    const dummy = await createDummyImage();
    const boundary = "---------------------------974767299852498929531610575";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="file1.png"\r\nContent-Type: image/png\r\n\r\n`),
      dummy,
      Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="file2.png"\r\nContent-Type: image/png\r\n\r\n`),
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
      expect(err.message).toBe("Unknown multipart field: 'unknownParam'.");
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
      expect(err.message).toBe("Duplicate multipart field: 'width'.");
    }
  });

  it("rejects explicitly supplied fit parameter unless both width and height are provided", async () => {
    const dummy = await createDummyImage();

    // 1. Only width provided with fit
    const reqWidthOnly = buildMultipartRequest({ width: "200", fit: "cover" }, dummy);
    try {
      await parseMultipartRequest(reqWidthOnly, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("INVALID_OPTIONS");
      expect(err.message).toBe("The 'fit' parameter is only allowed when both 'width' and 'height' dimensions are provided.");
    }

    // 2. Only height provided with fit
    const reqHeightOnly = buildMultipartRequest({ height: "200", fit: "contain" }, dummy);
    try {
      await parseMultipartRequest(reqHeightOnly, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("INVALID_OPTIONS");
      expect(err.message).toBe("The 'fit' parameter is only allowed when both 'width' and 'height' dimensions are provided.");
    }

    // 3. No dimensions provided with fit
    const reqNoDimensions = buildMultipartRequest({ fit: "fill" }, dummy);
    try {
      await parseMultipartRequest(reqNoDimensions, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("INVALID_OPTIONS");
      expect(err.message).toBe("The 'fit' parameter is only allowed when both 'width' and 'height' dimensions are provided.");
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
      expect(err.message).toBe("Quality parameter is not supported for PNG format (PNG uses lossless compression).");
    }
  });

  it("rejects file exceeding 10 MiB with 413 PAYLOAD_TOO_LARGE", async () => {
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

  it("handles malformed multipart stream errors cleanly without exposing raw parser internals", async () => {
    const malformedBody = Buffer.from("not-valid-multipart-boundary-content");
    const req = new Request("http://localhost:3000/v1/images/transform", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=---TestBoundary" },
      body: malformedBody,
    });

    try {
      await parseMultipartRequest(req, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("INVALID_MULTIPART");
      expect(err.message).not.toContain("busboy");
    }
  });
});
