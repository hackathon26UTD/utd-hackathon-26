import { response } from "@/lib/server";
export const runtime = "nodejs";
export async function GET() {
  return response({
    nessie: !!process.env.NESSIE_API_KEY,
    nessieCustomer: !!process.env.NESSIE_CUSTOMER_ID,
    mongodb: !!process.env.MONGODB_URI,
    ai: !!process.env.GEMINI_API_KEY,
    storage: process.env.MONGODB_URI ? "atlas" : "browser",
  });
}
