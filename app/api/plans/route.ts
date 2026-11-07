import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { planInputSchema, type SavedPlan } from "@/lib/model";
import { body, database, publicPlan, response, session } from "@/lib/server";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  if (!process.env.MONGODB_URI)
    return response({ plans: [], storage: "browser" });
  const sessionId = session(request);
  try {
    const db = await database();
    const plans = await db
      .collection<SavedPlan & { sessionId: string }>("plans")
      .find({ sessionId })
      .sort({ savedAt: -1 })
      .limit(20)
      .toArray();
    return response(
      { plans: plans.map(publicPlan), storage: "atlas" },
      sessionId,
    );
  } catch {
    return response(
      {
        error:
          "Atlas could not be reached. Your browser-saved plans remain available.",
      },
      sessionId,
      503,
    );
  }
}
export async function POST(request: NextRequest) {
  const sessionId = session(request);
  let input;
  try {
    input = planInputSchema.parse(await body(request));
  } catch {
    return response(
      { error: "The plan contains invalid fields. Check dates and amounts." },
      sessionId,
      400,
    );
  }
  if (!process.env.MONGODB_URI)
    return response(
      { error: "Atlas is not configured. Save this plan in your browser." },
      sessionId,
      503,
    );
  try {
    const db = await database();
    if (
      (await db
        .collection("plans")
        .countDocuments({ sessionId }, { limit: 20 })) >= 20
    )
      return response(
        { error: "You have 20 cloud plans. Delete one before saving another." },
        sessionId,
        409,
      );
    const plan = {
      ...input,
      id: randomUUID(),
      savedAt: new Date().toISOString(),
      sessionId,
    };
    await db.collection("plans").insertOne(plan);
    return response(
      { plan: publicPlan(plan), storage: "atlas" },
      sessionId,
      201,
    );
  } catch {
    return response(
      {
        error:
          "Atlas could not save this plan. It can still be saved in your browser.",
      },
      sessionId,
      503,
    );
  }
}
export async function DELETE(request: NextRequest) {
  const sessionId = session(request);
  let id: string;
  try {
    const parsed = await body(request);
    if (typeof parsed.id !== "string" || !/^[a-f0-9-]{36}$/.test(parsed.id))
      throw new Error();
    id = parsed.id;
  } catch {
    return response({ error: "Invalid plan ID." }, sessionId, 400);
  }
  if (!process.env.MONGODB_URI)
    return response({ error: "Atlas is not configured." }, sessionId, 503);
  try {
    const db = await database();
    await db.collection("plans").deleteOne({ sessionId, id });
    return response({ deleted: true }, sessionId);
  } catch {
    return response(
      { error: "Could not remove the cloud plan. Try again." },
      sessionId,
      503,
    );
  }
}
