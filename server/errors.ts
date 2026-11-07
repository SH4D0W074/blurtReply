export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code = 'REQUEST_FAILED') {
    super(message);
    this.name = 'HttpError';
  }
}
