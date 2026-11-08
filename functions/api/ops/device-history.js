import { historyHandler } from '../../../src/device-history.js';
export const onRequest = ctx => historyHandler(ctx, 'ops');
