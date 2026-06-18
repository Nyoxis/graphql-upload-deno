import { assert, assertEquals, assertExists, fail } from "../dev_deps.ts";
import { Upload } from "./upload.ts";
import { UploadError, UploadErrorCode } from "./upload-errors.ts";
import { processRequest } from "./process_request.ts";
import {
  attachStreamEndDetection,
  createMultipartMessage,
} from "../test/utils.ts";

Deno.test("processRequest loads simple file and parses variables", async () => {
  const boundary = "boundary123";

  const operations = JSON.stringify({
    query: "mutation ($file: Upload!) { upload(file: $file) }",
    variables: { file: null },
  });

  const map = JSON.stringify({
    f1: ["variables.file"],
  });

  const multipartBody = createMultipartMessage(boundary, {
    operations,
    map,
    f1: {
      filename: "hello.txt",
      mediaType: "text/plain",
      content: new TextEncoder().encode("Hello World"),
    },
  });

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(multipartBody);
      controller.close();
    },
  });

  const request = new Request("http://localhost/graphql", {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    body: stream,
  });
  // Call processRequest as your middleware would
  const result = await processRequest(request);
  assert(!Array.isArray(result), "should't be batched");

  // Assert on query
  assertEquals(
    result.query,
    "mutation ($file: Upload!) { upload(file: $file) }",
  );
  assertExists(result.variables, "should be variable");
  // Assert on file upload in variables
  const upload = result.variables?.file as Upload | undefined;
  assertExists(upload, "no file");
  const file = await upload?.promise;
  assertEquals(file.filename, "hello.txt");
  const content = await new Response(file.content).text();
  assertEquals(content, "Hello World");
});

Deno.test("processRequest loads batched request and returns batched result", async () => {
  const boundary = "batchboundary123";

  // Create a batch of two operations
  const operations = JSON.stringify([
    {
      query: "mutation ($file: Upload!) { upload(file: $file) }",
      variables: { file: null },
    },
    {
      query: "query { currentUser { id } }",
      variables: {},
    },
  ]);

  const map = JSON.stringify({
    f1: ["0.variables.file"],
  });

  const multipartBody = createMultipartMessage(boundary, {
    operations,
    map,
    f1: {
      filename: "batch.txt",
      mediaType: "text/plain",
      content: new TextEncoder().encode("Batch upload content"),
    },
  });

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(multipartBody);
      controller.close();
    },
  });

  const request = new Request("http://localhost/graphql", {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    body: stream,
  });

  const result = await processRequest(request);

  assert(Array.isArray(result), "should be batched array");

  // Check first operation query and file upload
  assertEquals(
    result[0].query,
    "mutation ($file: Upload!) { upload(file: $file) }",
  );
  assertExists(result[0].variables, "should have variables in first operation");
  // Check second operation query has no variables
  assertEquals(result[1].query, "query { currentUser { id } }");
  assertExists(
    result[1].variables,
    "should't be variables for the second operation",
  );
});

Deno.test("processRequest handles multiple files for one array variable", async () => {
  const boundary = "batchboundary123";

  const operations = JSON.stringify({
    query: "mutation ($files: [Upload!]!) { uploadFiles(files: $files) }",
    variables: { files: [null, null] },
  });

  const map = JSON.stringify({
    f1: ["variables.files.0"],
    f2: ["variables.files.1"],
  });

  const multipartBody = createMultipartMessage(boundary, {
    operations,
    map,
    f1: {
      filename: "file1.txt",
      mediaType: "text/plain",
      content: new TextEncoder().encode("File One Content"),
    },
    f2: {
      filename: "file2.txt",
      mediaType: "text/plain",
      content: new TextEncoder().encode("File Two Content"),
    },
  });

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(multipartBody);
      controller.close();
    },
  });

  const mockRequest = new Request("http://localhost/graphql", {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    body: stream,
  });

  const result = await processRequest(mockRequest);
  assert(!Array.isArray(result), "should't be batched");
  // Assert that the result variables 'files' is an array of length 2
  const files = result.variables?.files as Upload[] | undefined;
  assert(files, "no files");
  assert(Array.isArray(files), "files variable should be array");
  assertEquals(files.length, 2);

  // Check file details and content for both files
  for (const [index, upload] of files.entries()) {
    assertExists(upload, `no upload object for files[${index}]`);
  }
});

Deno.test("processRequest rejects when map points to wrong or non-existent file variable path", async () => {
  const boundary = "wrongmapboundary";

  const operations = JSON.stringify({
    query: "mutation ($file: Upload!) { upload(file: $file) }",
    variables: { file: null },
  });

  // Map points to a wrong variable path "variables.wrongFile" which doesn't exist in operations.variables
  const map = JSON.stringify({
    f1: ["variables.wrongFile"],
  });

  const multipartBody = createMultipartMessage(boundary, {
    operations,
    map,
    f1: {
      filename: "shouldnotexist.txt",
      mediaType: "text/plain",
      content: new TextEncoder().encode("This file should not map correctly"),
    },
  });

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(multipartBody);
      controller.close();
    },
  });

  const request = new Request("http://localhost/graphql", {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    body: stream,
  });
  try {
    // Assert processRequest throws or returns error due to invalid map field
    await processRequest(request);
  } catch (error) {
    if (!(error instanceof UploadError)) {
      fail("Expected error to be instance of UploadError");
    }
    if (error.code !== UploadErrorCode.INVALID_MAP) {
      fail(`Expected error.code to be INVALID_MAP, got ${error.code}`);
    }
  }
});

Deno.test("processRequest silently ignores extraneous files", async () => {
  const boundary = "extraneousBoundary";

  const operations = JSON.stringify({
    query: "mutation ($file: Upload!) { upload(file: $file) }",
    variables: { file: null },
  });

  const map = JSON.stringify({
    f1: ["variables.file"],
  });

  // Simulate multipart message with 2 files, but only "1" is mapped
  const multipartBody = createMultipartMessage(boundary, {
    operations,
    map,
    f1: {
      filename: "mappedFile.txt",
      mediaType: "text/plain",
      content: new TextEncoder().encode("Mapped file content"),
    },
    f2: {
      filename: "extraneousFile.txt",
      mediaType: "text/plain",
      content: new TextEncoder().encode(
        "This file is extraneous and should be ignored",
      ),
    },
  });

  const originalStream = new ReadableStream({
    start(controller) {
      controller.enqueue(multipartBody);
      controller.close();
    },
  });
  const { stream, ended } = attachStreamEndDetection(originalStream);
  const request = new Request("http://localhost/graphql", {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    body: stream,
  });

  // Call processRequest and ensure it resolves successfully
  const result = await processRequest(request);

  assert(!Array.isArray(result), "should't be batched");
  // Assert the mapped file is processed correctly
  const upload = result.variables?.file as Upload;
  const file = await upload.promise;
  const text = await new Response(file.content).text();
  assert(text === "Mapped file content");
  // if extraneous file is rejected stream should be ended
  assertEquals(await ended, undefined, "Stream should be closed at the end");
});

Deno.test("processRequest throws MissingMapError when no map", async () => {
  const boundary = "boundary123";
  const operations = JSON.stringify({
    query: "mutation { _ }",
  });

  const multipartBody = createMultipartMessage(boundary, {
    operations,
  });

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(multipartBody);
      controller.close();
    },
  });

  const request = new Request("http://localhost/graphql", {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    body: stream,
  });

  try {
    await processRequest(request);
    fail("Expected processRequest to reject");
  } catch (error) {
    if (!(error instanceof UploadError)) {
      fail("Expected error to be instance of UploadError");
    }
    if (error.code !== UploadErrorCode.MISSING_MAP) {
      fail(`Expected error.code to be MISSING_MAP, got ${error.code}`);
    }
  }
});

Deno.test("processRequest throws InvalidJSONError for bad operations JSON", async () => {
  const boundary = "boundary123";
  const operations = "not-a-json";

  const map = JSON.stringify({ "1": ["variables.file"] });

  const multipartBody = createMultipartMessage(boundary, {
    operations,
    map,
  });

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(multipartBody);
      controller.close();
    },
  });

  const request = new Request("http://localhost/graphql", {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    body: stream,
  });

  try {
    await processRequest(request);
    fail("Expected processRequest to reject");
  } catch (error) {
    if (!(error instanceof UploadError)) {
      fail("Expected error to be instance of UploadError");
    }
    if (error.code !== UploadErrorCode.INVALID_JSON) {
      fail(`Expected error.code to be INVALID_JSON, got ${error.code}`);
    }
  }
});

Deno.test("processRequest enforces maxHeaderSize option", async () => {
  const boundary = "boundary123";
  const operations = JSON.stringify({
    query: "mutation ($file: Upload!) { upload(file: $file) }",
    variables: { file: null },
  });

  const map = JSON.stringify({
    f1: ["variables.file"],
  });

  const multipartBody = createMultipartMessage(boundary, {
    operations,
    map,
    f1: {
      filename: "hello.txt",
      mediaType: "text/plain",
      content: new TextEncoder().encode("Hello World"),
    },
  });

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(multipartBody);
      controller.close();
    },
  });

  const request = new Request("http://localhost/graphql", {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    body: stream,
  });

  try {
    // Set maxHeaderSize to 5, which is smaller than any standard part header
    await processRequest(request, { maxHeaderSize: 5 });
    fail("Expected processRequest to reject due to small maxHeaderSize");
  } catch (error) {
    if (!(error instanceof Error)) {
      fail("Expected error to be instance of Error");
    }
    // Check that it's an InvalidMultipartError or contains the maxHeaderSize exceed message
    assert(
      error.message.includes("exceeds maximum allowed size"),
      `Expected header size exceed error, got: ${error.message}`,
    );
  }
});

Deno.test("processRequest with invalid multipart form field `map` entry array item object path.", async () => {
  const boundary = "boundary123";

  const operations = JSON.stringify({
    variables: "",
  });

  const map = JSON.stringify({
    1: ["variables.file"],
  });

  const multipartBody = createMultipartMessage(boundary, {
    operations,
    map,
    1: {
      filename: "a.txt",
      mediaType: "text/plain",
      content: new TextEncoder().encode("a"),
    },
  });

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(multipartBody);
      controller.close();
    },
  });

  const request = new Request("http://localhost/graphql", {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    body: stream,
  });

  try {
    await processRequest(request);
    fail("Expected processRequest to reject");
  } catch (error) {
    if (!(error instanceof UploadError)) {
      fail("Expected error to be instance of UploadError");
    }
    if (error.code !== UploadErrorCode.INVALID_MAP) {
      fail(`Expected error.code to be INVALID_MAP, got ${error.code}`);
    }
    assert(
      error.message.includes(
        "Invalid object path for the ‘map’ multipart field entry key ‘1’ array index ‘0’ value ‘variables.file’"
      ),
      `Expected message to contain invalid object path message, got: ${error.message}`
    );
  }
});
