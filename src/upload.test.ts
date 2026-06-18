import { describe, it, expect } from "../dev_deps.ts";
import { Upload } from "./upload.ts";
import type { FileUpload } from "./upload.ts";

describe("Upload", () => {
  it("`Upload` class resolving a file.", async () => {
    const upload = new Upload();

    expect(upload.promise).toBeInstanceOf(Promise);
    expect(typeof upload.resolve).toBe("function");

    const file: FileUpload = {
      filename: "test.txt",
      fieldName: "file",
      mimetype: "text/plain",
      content: new ReadableStream(),
    };

    upload.resolve(file);

    const resolved = await upload.promise;

    expect(resolved).toBe(file);
    expect(upload.file).toBe(file);
  });

  it("`Upload` class with a handled rejection.", async () => {
    const upload = new Upload();

    expect(upload.promise).toBeInstanceOf(Promise);
    expect(typeof upload.reject).toBe("function");

    const error = new Error("Message.");

    upload.reject(error);

    await expect(upload.promise).rejects.toThrow("Message.");
  });

  it("`Upload` class with an unhandled rejection.", async () => {
    const upload = new Upload();

    expect(upload.promise).toBeInstanceOf(Promise);
    expect(typeof upload.reject).toBe("function");

    const error = new Error("Message.");

    upload.reject(error);

    // Rely on the fact that Deno handles unhandled rejections properly.
    await new Promise((r) => setTimeout(r, 10));
  });
});
