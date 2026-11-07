import { withDatabase } from '../../lib/mongodb.js';

export async function onRequestGet({ env }) {
  try {
    await withDatabase(env, (db) => db.command({ ping: 1 }));
    return Response.json(
      { status: 'ready', mongodb: { connected: true } },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    // Driver errors can contain hostnames and credentials. Return no raw error.
    return Response.json(
      { status: 'not_ready', mongodb: { connected: false } },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
