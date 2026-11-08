import { opsLive } from '../../../src/live-api.js';
export const onRequest = ({ request, env, data }) => opsLive({ request, env, data });
