import { opsLogs } from '../../../src/live-api.js';
export const onRequest = ({ request, env, data }) => opsLogs({ request, env, data });
