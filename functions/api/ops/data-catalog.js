import { dataApi } from '../../../src/data-api.js';
export const onRequest = ({ request, env, data }) => dataApi({request,env,data}, 'catalog');
