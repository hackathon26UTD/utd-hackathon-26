import { handleOverlays } from '../../src/feeds-api.js';

// GET /api/overlays?layer=zones|nfhl|nws|...&bbox=w,s,e,n. Zones also take POST, PATCH and DELETE.
export const onRequest = ({ request, env, data }) => handleOverlays(request, env, { operator: data?.operator });
