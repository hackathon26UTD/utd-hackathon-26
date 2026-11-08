import { opsDeviceTimeline } from '../../../src/timeline.js';
export const onRequest = ({ request, env, data }) => opsDeviceTimeline({ request, env, data });
