import { customerHandler } from '../../../src/customer.js';
export const onRequest = ctx => customerHandler('messages', ctx);
