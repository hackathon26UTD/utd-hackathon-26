import { opsPlace } from '../../../src/place.js';
export const onRequest = ({ request, env, data }) => opsPlace({ request, env, data });
