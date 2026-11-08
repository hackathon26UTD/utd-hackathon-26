import {oauthHandler} from '../../src/customer-oauth.js';
export const onRequest=ctx=>oauthHandler('register',ctx);
