import { customerHandler } from '../../../src/customer.js';
export const onRequest = ctx => customerHandler('logout', ctx);
