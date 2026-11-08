import { handleFeeds } from '../../src/feeds-api.js';

// GET lists every source with status and data age. POST {layer,bbox} warms one layer.
export const onRequest = ({ request, env, data }) => handleFeeds(request, env, { operator: data?.operator });
