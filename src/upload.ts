export interface FileUpload {
  readonly filename: string;
  readonly fieldName: string;
  // should be WebApi mediaType, but kept as mimeType in re-exported functions
  readonly mimetype: string;
  readonly content: ReadableStream;
}

export class Upload {
  public readonly promise: Promise<FileUpload>;
  public file?: FileUpload;
  private _resolve!: (file: FileUpload) => void;
  private _reject!: (error: Error) => void;

  constructor() {
    this.promise = new Promise<FileUpload>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });

    // Prevent unhandled promise rejection errors
    this.promise.catch(() => {});
  }

  public resolve(file: FileUpload): void {
    this.file = file;
    this._resolve(file);
  }

  public reject(error: Error): void {
    this._reject(error);
  }
}
