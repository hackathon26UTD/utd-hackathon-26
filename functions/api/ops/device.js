import { opsDevice } from '../../../src/live-api.js';
export const onRequest = ({ request, env, data }) => opsDevice({ request, env, data });
