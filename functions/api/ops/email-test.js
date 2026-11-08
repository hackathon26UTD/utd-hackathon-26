import { emailTestHandler } from '../../../src/email-api.js';
export const onRequest = (ctx) => emailTestHandler(ctx);
