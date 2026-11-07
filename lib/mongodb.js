import { MongoClient } from 'mongodb';

// Pages requests have separate I/O lifetimes; close each request's client.
export async function withDatabase(env, operation) {
  if (!env.MONGODB_URI || !env.MONGODB_DB) {
    throw new Error('Database settings are missing');
  }
  const client = new MongoClient(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 4000,
    connectTimeoutMS: 4000,
    socketTimeoutMS: 4000,
    maxPoolSize: 1,
  });
  try {
    await client.connect();
    return await operation(client.db(env.MONGODB_DB));
  } finally {
    await client.close();
  }
}
