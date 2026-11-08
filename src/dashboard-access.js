import {onRequest as operatorLogin} from '../functions/api/session.js';
import {customerHandler} from './customer.js';
import {readSession, readCustomerSession, sameOrigin, sessionCookie, customerCookie} from './operator-session.js';

const reply = (body, status = 200, extra = {}) => {const headers = new Headers(extra); headers.set('Cache-Control','no-store'); return Response.json(body, {status, headers});};
const destination = (role, next) => role === 'customer' ? '/customer' : role === 'demo' ? '/simulations' : next === 'review' ? '/command-center?view=review' : '/command-center';
function signedIn(response, role, next, signup = false) {
  const headers = new Headers(response.headers);
  // The last successful sign-in determines Dashboard's destination. Cookies still have separate authority.
  headers.append('Set-Cookie', role === 'customer' ? sessionCookie('', 0) : customerCookie('', 0));
  return reply({authenticated:true, role, destination:destination(role, next) + (signup ? '#add-device' : '')}, response.status, headers);
}

export async function dashboardAccess(ctx) {
  const {request, env} = ctx;
  if (request.method === 'GET') {
    const account = await readSession(request, env) || await readCustomerSession(request, env, ctx.db);
    return reply(account ? {authenticated:true, role:account.role, destination:destination(account.role)} : {authenticated:false}, account ? 200 : 401);
  }
  if (request.method !== 'POST') return reply({error:'Method not allowed.'}, 405);
  if (!sameOrigin(request)) return reply({error:'This request must come from Safe Home.'}, 403);
  let body;
  try { const text = await request.text(); if (text.length > 4096) return reply({error:'Request is too large.'}, 413); body = JSON.parse(text); }
  catch { return reply({error:'Enter your account details.'}, 400); }
  if (!body || !['login','signup'].includes(body.action)) return reply({error:'Choose sign up or sign in.'}, 400);
  const forward = data => ({...ctx, request:new Request(request.url, {method:'POST', headers:request.headers, body:JSON.stringify(data)})});
  if (body.action === 'signup') {
    // Public registration always creates a customer. No role, device or privilege fields are forwarded.
    const response = await customerHandler('register', forward({email:body.email,password:body.password,contactName:body.contactName,acceptTerms:body.acceptTerms,consent:false}));
    return response.ok ? signedIn(response, 'customer', null, true) : response;
  }
  const credentials = {email:body.email,password:body.password};
  const operator = await operatorLogin(forward(credentials));
  if (operator.ok) return signedIn(operator, (await operator.clone().json()).role, body.next);
  // Never bypass throttling or provider errors by falling back to another account type.
  if (operator.status !== 401) return operator;
  const customer = await customerHandler('login', forward(credentials));
  return customer.ok ? signedIn(customer, 'customer') : customer;
}
