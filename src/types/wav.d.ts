/**
 * Type declarations for wav package
 */
declare module 'wav' {
  import { Writable } from 'stream';

  export interface WriterOptions {
    sampleRate: number;
    channels: number;
    bitDepth: number;
  }

  export class Writer extends Writable {
    constructor(options: WriterOptions);
  }

  export class Reader extends NodeJS.ReadableStream {
    constructor();
    on(event: 'format', listener: (format: WriterOptions) => void): this;
    on(event: 'data', listener: (chunk: Buffer) => void): this;
    on(event: 'end', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }
}
