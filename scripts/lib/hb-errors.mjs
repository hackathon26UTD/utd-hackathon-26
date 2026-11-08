// Exit codes and the one error type commands throw.
export const EXIT = Object.freeze({ OK: 0, FAIL: 1, USAGE: 2, NETWORK: 3, AUTH: 4 });

export class HbError extends Error {
  constructor(message, code = EXIT.FAIL) { super(message); this.name = 'HbError'; this.code = code; }
}
export const usageError = (m) => new HbError(m, EXIT.USAGE);
