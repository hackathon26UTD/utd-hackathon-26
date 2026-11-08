import { handlePublicNews } from '../../../src/public-context.js';
export const onRequest=({request,env})=>handlePublicNews(request,env);
