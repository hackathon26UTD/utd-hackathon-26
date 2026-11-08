import { handlePublicFeeds } from '../../../src/public-context.js';
export const onRequest=({request,env})=>handlePublicFeeds(request,env);
