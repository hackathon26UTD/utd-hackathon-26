import { ingestWithDownlink } from '../../../src/live-api.js';
export const onRequest = ({ request, env, data }) => ingestWithDownlink({ request, env, data });
