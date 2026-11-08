import { deviceLogs } from '../../../src/live-api.js';
export const onRequest = ({ request, env, data }) => deviceLogs({ request, env, data });
