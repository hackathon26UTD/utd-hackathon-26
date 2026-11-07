import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import type { SavedPlan } from "./model";

const globalMongo = globalThis as unknown as {
  futureyouMongo?: Promise<MongoClient>;
};
export async function database() {
  if (!process.env.MONGODB_URI)
    throw new Error(
      "MongoDB is not configured. Plans can still be saved in this browser.",
    );
  if (!globalMongo.futureyouMongo) {
    const client = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 7000,
      maxPoolSize: 5,
    });
    globalMongo.futureyouMongo = client.connect().catch((error) => {
      globalMongo.futureyouMongo = undefined;
      throw error;
    });
  }
  return (await globalMongo.futureyouMongo).db(
    process.env.MONGODB_DB || "futureyou",
  );
}
export function session(request: NextRequest) {
  const existing = request.cookies.get("futureyou-session")?.value;
  return existing && /^[a-f0-9-]{36}$/.test(existing) ? existing : randomUUID();
}
export function response(data: unknown, sessionId?: string, status = 200) {
  const res = NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
  if (sessionId)
    res.cookies.set("futureyou-session", sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  return res;
}
export async function body(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && new URL(origin).host !== host)
    throw new Error("Request origin does not match this app.");
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new Error("Use JSON for this request.");
  const raw = await request.text();
  if (raw.length > 65536) throw new Error("Request is too large.");
  return JSON.parse(raw);
}
export function publicPlan(
  plan: SavedPlan & { _id?: unknown; sessionId?: string },
): SavedPlan {
  return {
    id: plan.id,
    savedAt: plan.savedAt,
    portfolio: plan.portfolio,
    scenario: plan.scenario,
  };
}
