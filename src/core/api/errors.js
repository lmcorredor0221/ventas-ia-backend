export class ApiError extends Error {
  constructor(message, { status = 0, code = null, payload = null, url = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.payload = payload;
    this.url = url;
  }
}
