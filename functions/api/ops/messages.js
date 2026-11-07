import { opsMessages } from '../../../src/live-api.js';
export const onRequest = ({ request, env, data }) => opsMessages({ request, env, data });
