import { SuperHeaders } from '../dev_deps.ts'
/**
 * from <https://github.com/Nyoxis/remix/blob/9cea56dcdc7596f706248e8492d9361282b4e20c/packages/multipart-parser/test/utils.ts>
 */
export type PartValue =
  | string
  | {
      filename?: string
      filenameSplat?: string
      mediaType?: string
      content: string | Uint8Array
    }

export function createMultipartMessage(
  boundary: string,
  // parts name shouldn't be numbers, as it disrupts the order
  parts?: { [name: string]: PartValue },
): Uint8Array {
  const chunks: Uint8Array[] = []

  function pushString(string: string) {
    chunks.push(new TextEncoder().encode(string))
  }

  function pushLine(line = '') {
    pushString(line + '\r\n')
  }

  if (parts) {
    for (const [name, value] of Object.entries(parts)) {
      pushLine(`--${boundary}`)

      if (typeof value === 'string') {
        const headers = new SuperHeaders({
          contentDisposition: {
            type: 'form-data',
            name,
          },
        })

        pushLine(`${headers}`)
        pushLine()
        pushLine(value)
      } else {
        const headers = new SuperHeaders({
          contentDisposition: {
            type: 'form-data',
            name,
            filename: value.filename,
            filenameSplat: value.filenameSplat,
          },
        })

        if (value.mediaType) {
          headers.contentType = value.mediaType
        }

        pushLine(`${headers}`)
        pushLine()
        if (typeof value.content === 'string') {
          pushLine(value.content)
        } else {
          chunks.push(value.content)
          pushLine()
        }
      }
    }
  }

  pushString(`--${boundary}--`)

  return concat(chunks)
}

export function concat(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0]

  let length = 0
  for (const chunk of chunks) {
    length += chunk.length
  }

  const result = new Uint8Array(length)
  let offset = 0

  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  return result
}

export function attachStreamEndDetection<T>(originalStream: ReadableStream<T>): { stream: ReadableStream<T>, ended: Promise<void> } {
  let endedResolve: () => void;
  let endedReject: (_: unknown) => void;

  const ended = new Promise<void>((resolve, reject) => {
    endedResolve = resolve;
    endedReject = reject;
  });

  const instrumentedStream = new ReadableStream<T>({
    start(controller) {
      const reader = originalStream.getReader();

      function read() {
        reader.read().then(({ done, value }) => {
          if (done) {
            endedResolve();
            controller.close();
            return;
          }
          controller.enqueue(value);
          read();
        }).catch(e => {
          endedReject(e);
          controller.error(e);
        });
      }

      read();
    },
    cancel(reason) {
      return originalStream.cancel(reason);
    },
  });

  return { stream: instrumentedStream, ended };
}
