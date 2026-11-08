import {deviceSettings} from '../../../src/data-api.js';
export const onRequest=({request,env,data})=>deviceSettings({request,env,data});
