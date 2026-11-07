export function onRequestGet({ env }) {
  return Response.json(
    {
      status: 'ok',
      mongodb: {
        configured: Boolean(env.MONGODB_URI && env.MONGODB_DB),
        connectionTested: false,
      },
    },
    { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
  );
}
