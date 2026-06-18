# GraphQL Upload for Deno/Bun

A port of [**graphql-upload-ts**](https://github.com/meabed/graphql-upload-ts) that works with any Web API–compatible server runtime such as **Deno**, **Bun**.

## Features

- **Standard Web API support** - Built to work natively with any standard Web API-compatible runtime like Deno and Bun.
- **Streaming file uploads** - Processes files via Web API ReadableStream, avoiding full in-memory buffering.
- **File validation & sanitization** - Built-in utilities for sanitizing filenames and validating MIME types/extensions.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Documentation](#api-documentation)
- [Security & Validation](#security--validation)
- [License](#license)

## Installation

Since this library is published as a Deno module, you can import it directly using its JSR specifier or your import map:

```typescript
import { GraphQLUpload, graphqlHttpWithUploadOak, processRequest } from "jsr:@nyoxis/graphql-upload-deno";
```

## Quick Start

### Basic Setup with Oak & @deno-libs/gql

```typescript
import { Application, Router } from "jsr:@oak/oak";
import { GraphQLHTTP } from "jsr:@deno-libs/gql";
import { makeExecutableSchema } from "npm:@graphql-tools/schema";
import { GraphQLUpload, graphqlHttpWithUploadOak } from "jsr:@nyoxis/graphql-upload-deno";

const typeDefs = `
  scalar Upload

  type Mutation {
    uploadFile(file: Upload!): String!
  }

  type Query {
    hello: String!
  }
`;

const resolvers = {
  Upload: GraphQLUpload,
  Query: {
    hello: () => "Hello World",
  },
  Mutation: {
    uploadFile: async (_parent: unknown, { file }: { file: Promise<any> }) => {
      const { filename, mimetype, content } = await file;
      
      // `content` is a standard Web API ReadableStream<Uint8Array>
      const reader = content.getReader();
      // Process the stream chunks...
      
      return `File ${filename} uploaded successfully`;
    },
  },
};

const schema = makeExecutableSchema({ typeDefs, resolvers });

const router = new Router();
router.post(
  "/graphql",
  graphqlHttpWithUploadOak(
    { maxFileSize: 10_000_000, maxFiles: 10 },
    { schema }
  )
);

const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());

await app.listen({ port: 4000 });
```

## API Documentation

### Middleware Functions

#### `graphqlHttpWithUploadOak(uploadOptions?, graphqlOption?)`

Oak middleware for handling multipart/form-data requests.

```typescript
import { graphqlHttpWithUploadOak } from 'jsr:@nyoxis/graphql-upload-deno';

router.post('/graphql', graphqlHttpWithUploadOak({
  maxFileSize: 10000000,  // 10 MB for file uploads (default: 5 MB)
  maxFiles: 10,           // Max number of files (default: Infinity)
  maxFieldSize: 1000000,  // 1 MB for JSON fields (default: 1 MB)
}, { schema }));
```

### Types

#### `FileUpload`

The promise returned from uploaded files resolves to:

```typescript
interface FileUpload {
  filename: string;
  mimetype: string;
  fieldName: string;
  content: ReadableStream<Uint8Array>;
}
```

#### `UploadOptions`

Configuration options for the middleware:

```typescript
interface UploadOptions {
  maxFieldSize?: number;    // Max size of non-file fields like JSON (default: 1 MB)
  maxFileSize?: number;     // Max size per file upload (default: 5 MB) 
  maxFiles?: number;        // Max number of files (default: Infinity)
  maxHeaderSize?: number;   // Max size of headers in bytes (default: 8 KiB)
  maxParts?: number;        // Max number of parts in the multipart message (default: 1000)
  maxTotalSize?: number;    // Max aggregate size of all parts in bytes
  queuingStrategy?: QueuingStrategy<Uint8Array>; // Queuing strategy for part ReadableStreams
}
```

### Scalar Type

#### `GraphQLUpload`

The GraphQL scalar type for file uploads. Use it in your schema:

```typescript
import { GraphQLUpload } from 'jsr:@nyoxis/graphql-upload-deno';

// For schema-first approach (SDL)
const resolvers = {
  Upload: GraphQLUpload,
  // ... other resolvers
};
```

## Security & Validation

### Built-in Protections

The library includes several security features:

- **File size limits** - Prevent large file DoS attacks
- **File count limits** - Restrict number of concurrent uploads
- **Field size limits** - Limit non-file field sizes
- **Header size limits** - Restrict header size to avoid memory exploitation
- **Parts count limits** - Limit total parts to prevent parser exhaustion
- **Total aggregate size limits** - Limit total combined size of all parts
- **Filename sanitization** - Remove unsafe characters from filenames
- **MIME type validation** - Optional MIME type restrictions
- **File extension validation** - Restrict uploaded files to allowed extensions

### Validation Utilities

```typescript
import { 
  validateMimeType, 
  validateFileExtension, 
  sanitizeFilename 
} from 'jsr:@nyoxis/graphql-upload-deno';

// Validate MIME type
const mimeResult = validateMimeType(mimetype, ['image/jpeg', 'image/png']);
if (!mimeResult.isValid) {
  throw new Error(mimeResult.error);
}

// Validate file extension
const extResult = validateFileExtension(filename, ['.jpg', '.jpeg', '.png']);
if (!extResult.isValid) {
  throw new Error(extResult.error);
}

// Sanitize filename for safe storage
const safe = sanitizeFilename('../../dangerous/file name!.txt');
// Returns: "dangerousfilename.txt"
```

### Error Handling

The library provides custom error classes:

```typescript
import { UploadError, UploadErrorCode } from 'jsr:@nyoxis/graphql-upload-deno';

try {
  // Upload logic
} catch (error) {
  if (error instanceof UploadError) {
    switch (error.code) {
      case UploadErrorCode.FILE_TOO_LARGE:
        // Handle large file
        break;
      case UploadErrorCode.TOO_MANY_FILES:
        // Handle too many files
        break;
      // ... handle other cases
    }
  }
}
```

Error codes available:
- `FILE_TOO_LARGE` - File exceeds maxFileSize
- `TOO_MANY_FILES` - Too many files uploaded
- `FIELD_TOO_LARGE` - Non-file field too large
- `MISSING_OPERATIONS` - Missing operations field
- `MISSING_MAP` - Missing map field
- `INVALID_JSON` - Invalid JSON in operations or map
- `INVALID_MAP` - Invalid map structure or target path

## License

[MIT](./LICENSE)
