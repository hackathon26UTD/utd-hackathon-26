import { handlePublicOverlays } from '../../../src/public-context.js';
export const onRequest=({request,env})=>handlePublicOverlays(request,env);
