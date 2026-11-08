import { deviceMessages } from '../../../src/live-api.js';
export const onRequest = ({ request, env, data }) => deviceMessages({ request, env, data });
