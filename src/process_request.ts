import {
  MultipartParseError,
  MaxFileSizeExceededError,
  type BufferedMultipartPart,
  type StreamedMultipartPart,
  parseMultipartRequestAsStreams,
  objectPath,
} from "../deps.ts";

import {
  InvalidJSONError,
  TooManyFilesError,
  InvalidMapError,
  FileTooLargeError,
  FieldTooLargeError,
  InvalidMultipartError,
  MissingMapError,
  MissingOperationsError,
  FileMissingError
} from "./upload-errors.ts";

import {
  DEFAULT_MAX_FIELD_SIZE,
  DEFAULT_MAX_FILE_SIZE,
  DEFAULT_MAX_FILES,
} from "./validation.ts";

import {
  Upload
} from "./upload.ts"

import type { IncomingMessage } from "node:http";

export interface UploadOptions {
  /**
   * Maximum allowed size for non-file form fields (in bytes).
   * This limits the size of text fields like 'operations' and 'map' JSON.
   * @default 1_000_000 (1MB)
   */
  maxFieldSize?: number;

  /**
   * Maximum allowed size for uploaded files (in bytes).
   * This limits the size of actual file content being uploaded.
   * @default 5_000_000 (5MB)
   */
  maxFileSize?: number;

  /**
   * Maximum number of files allowed in a single request.
   * @default Infinity
   */
  maxFiles?: number;

  /**
   * The maximum allowed size of a header in bytes.
   * @default 8192 (8 KiB)
   */
  maxHeaderSize?: number;

  /**
   * The maximum allowed number of parts in the multipart message.
   * @default 1000
   */
  maxParts?: number;

  /**
   * The maximum allowed aggregate size of all part content in bytes.
   */
  maxTotalSize?: number;

  /**
   * The queuing strategy used by the ReadableStream of each parsed part.
   */
  queuingStrategy?: QueuingStrategy<Uint8Array>;
}

export interface GraphQLOperation {
  query: string;
  operationName?: string | null;
  variables?: Record<string, unknown> | null;
}

export type IncomingReq = Pick<
  IncomingMessage,
  'headers' | 'pipe' | 'unpipe' | 'once' | 'resume' | 'readableEnded'
> & {
  body?: string;
  rawBody?: string;
  req?: IncomingMessage;
};

// Creates helper to reject all pending uploads with an error
type RejectAllUpload = (error: Error) => void
function createRejectAllUploads(
  map: Map<string, Upload>,
): RejectAllUpload {
  return (error) => {
    for (const upload of map.values()) {
      // Reject only unresolved uploads
      if (!upload.file) {
        upload.reject(error);
      }
    }
  }
}

function parseJsonField(
  fieldPart: BufferedMultipartPart
): object {
  let parsed
  try {
    // Buffered previosly if field is text
    parsed = JSON.parse(fieldPart.text);
  } catch {
    throw new InvalidJSONError(fieldPart.name!)
  }
  // `filed` should be an object or an array. Note that arrays
  // and `null` have an `object` type.
  if (typeof parsed !== 'object' || !parsed) {
    throw new InvalidJSONError(fieldPart.name!)
  }
  return parsed
}

function setupUploadMap(
  operationsPath: ReturnType<typeof objectPath>,
  parsedMap: Record<string, unknown>,
  maxFiles: number
): Map<string, Upload> {
  const entries = Object.entries(parsedMap);
  // Check max files is not exceeded, even though the number of files
  // to parse might not match the map provided by the client.
  if (entries.length > maxFiles) {
    throw new TooManyFilesError(maxFiles)
  }
  const map = new Map<string, Upload>();
  for (const [fieldName, paths] of entries) {
    if (!Array.isArray(paths)) {
      throw new InvalidMapError(`Invalid type for the ‘map’ multipart field entry key ‘${fieldName}’ array`)
    }
    const upload = new Upload();
    map.set(fieldName, upload);
    for (const [index, path] of paths.entries()) {
      if (typeof path !== "string") {
        throw new InvalidMapError(`Invalid type for the ‘map’ multipart field entry key ‘${fieldName}’ array index ‘${index}’ value`)
      }
      try {
        if (operationsPath.get(path) !== null) {
          throw new Error("Invalid object path");
        }
        operationsPath.set(path, map.get(fieldName)); // ensures it's the same object
      } catch {
        throw new InvalidMapError(`Invalid object path for the ‘map’ multipart field entry key ‘${fieldName}’ array index ‘${index}’ value ‘${path}’`)
      }
    }
  }
  return map;
}

function createFileUploadHandler(map: Map<string, Upload>, options: UploadOptions): MultipartPartHandler {
  const { maxFileSize = DEFAULT_MAX_FILE_SIZE, maxFiles = DEFAULT_MAX_FILES } = options;
  let fileCount = 0
  return (part, _) => {
    if (part?.isFile) {
      if (++fileCount > maxFiles) {
        throw new TooManyFilesError(maxFiles)
      }
      const upload = map.get(part.name ?? "");
      if (!upload) {
        // The file is extraneous. As the rest can still be processed, just
        // ignore it and don’t exit with an error.
        part.close();
        return { done: false }
      }
      if (part.contentLength > maxFileSize) {
        upload.reject(new FileTooLargeError(maxFileSize))
        part.close()
        return { done: false }
      }
      const fileUpload = {
        filename: part.filename!,
        fieldName: part.name!,
        mimetype: part.mediaType!,
        content: part.content,
      };
      upload.resolve(fileUpload);
    }
    return { done: false }
  }
}

type MultipartPartHandler = (part: StreamedMultipartPart | null, lastTextPart: BufferedMultipartPart | undefined) => {done: boolean}
function createMultipartUploadRequestParser(request: Request, options: UploadOptions) {
  const {
    maxFieldSize = DEFAULT_MAX_FIELD_SIZE,
    maxFileSize = DEFAULT_MAX_FILE_SIZE,
    maxHeaderSize,
    maxParts,
    maxTotalSize,
    queuingStrategy,
  } = options;
  let lastTextPart: Promise<BufferedMultipartPart> | null
  const multipartParser = parseMultipartRequestAsStreams(request, {
    maxFileSize,
    maxHeaderSize,
    maxParts,
    maxTotalSize,
    queuingStrategy,
  })
  return async function parseMultipartUploadRequest(handler: MultipartPartHandler, rejectAllUploads?: RejectAllUpload) {
    try {
      // for await doesn't work because interrupted iterator throws at unresolved promises
      while (true) {
        const {value, done} = await multipartParser.next()
        if (done) {
          break
        }
        if (!value) continue
        if (!value.name) continue; // Ignore unnamed parts
        let lastTextPartResolved
        if (lastTextPart) {
          lastTextPartResolved = await lastTextPart
          lastTextPart = null
        }
        const result = handler(value, lastTextPartResolved)
        if (value.isText && !value.content.locked) {
          if (value.contentLength > maxFieldSize) {
            throw new FieldTooLargeError(value.name, maxFieldSize)
          }
          lastTextPart = value.toBuffered();
        }
        if ( result.done ) return
      }
      // If there's last buffered part, passing it with one additional empty part
      // for correct error handling
      if (lastTextPart) {
        handler(null, await lastTextPart)
        lastTextPart = null
      }
      rejectAllUploads?.(new FileMissingError) // reject all unresolved uploads
    } catch (error) {
      rejectAllUploads?.(error as Error)
      if (error instanceof MaxFileSizeExceededError) {
        // Caused when actual field/file size is larger than declared in header
        throw new FileTooLargeError(maxFileSize)
      } else if (error instanceof MultipartParseError) {
        throw new InvalidMultipartError(error.message)
      }
      throw error
    }
  }
}

export async function processRequest<T = GraphQLOperation | GraphQLOperation[]>(
  request: Request,
  options?: UploadOptions
): Promise<T> {
  const {
    maxFieldSize = DEFAULT_MAX_FIELD_SIZE,
    maxFileSize = DEFAULT_MAX_FILE_SIZE,
    maxFiles = DEFAULT_MAX_FILES,
    maxHeaderSize,
    maxParts,
    maxTotalSize,
    queuingStrategy,
  } = options ?? {};
  const filledOptions = { maxFieldSize, maxFileSize, maxFiles, maxHeaderSize, maxParts, maxTotalSize, queuingStrategy };

  let operations: T | undefined;
  let fileUploadHandler: MultipartPartHandler | undefined;
  let rejectAllUploads: RejectAllUpload | undefined;
  const parseMultipartUploadRequest = createMultipartUploadRequestParser(request, filledOptions)
  await parseMultipartUploadRequest((part, lastTextPart) => {
    if (lastTextPart) {
      switch (lastTextPart.name) {
        case "operations": {
          operations = parseJsonField(lastTextPart) as T
          break
        }
        case "map": {
          if (!operations) {
            throw new InvalidMultipartError(`Disordered multipart fields; ‘map’ should follow ‘operations’`)
          }
          const parsedMap = parseJsonField(lastTextPart) as Record<string, unknown>
          if (Array.isArray(parsedMap)) {
            throw new InvalidMapError('Map is not an array')
          }
          const map = setupUploadMap(objectPath(operations), parsedMap, maxFiles)
          rejectAllUploads = createRejectAllUploads(map)
          fileUploadHandler = createFileUploadHandler(map, filledOptions)
          // handle current incoming part
          fileUploadHandler(part, lastTextPart)
          return { done: true }
        }
      }
    }
    return { done: false }
  });
  if (!operations) {
    throw new MissingOperationsError()
  }
  if (!fileUploadHandler) {
    throw new MissingMapError()
  }
  // Detached async task for files upload
  parseMultipartUploadRequest(fileUploadHandler, rejectAllUploads).catch(
    (_err) => {
      /*
       * This error is already handled by individual upload.reject(err) calls
       * through rejectAllUploads handler. We catch it here to prevent
       * unhandled promise rejection in the server.
       */
    },
  );
  return operations
}