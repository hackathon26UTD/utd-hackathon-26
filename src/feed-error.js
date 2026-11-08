import { HttpError } from './http.js';

// An HttpError whose extra fields (for example `layer`) are returned next to `error`.
export class FeedError extends HttpError {
  constructor(status, message, extra = {}) {
    super(status, message);
    this.extra = extra;
  }
}
