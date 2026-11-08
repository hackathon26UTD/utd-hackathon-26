import { createDemoScenario, DEFAULT_DEMO_SCENARIO, DEMO_SCENARIOS, isDemoScenario } from '../../domain/demo-scenarios.js';

// Deliberately independent of env, sessions, MongoDB, feeds, and device command handlers.
export async function onRequest({ request }) {
  const headers = { 'Cache-Control': 'no-store', 'X-HomeBeacon-Data': 'synthetic' };
  if (!['GET', 'HEAD'].includes(request.method)) {
    return Response.json({ error: 'This demo is read-only.' }, { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
  }
  const selections = new URL(request.url).searchParams.getAll('scenario');
  const id = selections.length ? selections[0] : DEFAULT_DEMO_SCENARIO;
  const response = selections.length > 1 || !isDemoScenario(id)
    ? Response.json({ error: 'Choose a supported demo scenario.', allowedScenarios: DEMO_SCENARIOS.map(scenario => scenario.id) }, { status: 400, headers })
    : Response.json(createDemoScenario(id), { headers });
  return request.method === 'HEAD' ? new Response(null, response) : response;
}
