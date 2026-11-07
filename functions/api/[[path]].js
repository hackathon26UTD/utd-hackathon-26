// Every /api/* request is handled by the router in src/app.js.
import { handle } from '../../src/app.js';

export const onRequest = (ctx) => handle(ctx.request, ctx.env);
