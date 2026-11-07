import { importNessie } from "@/lib/nessie";
import { response } from "@/lib/server";
export const runtime = "nodejs";
let cached:
  | { portfolio: Awaited<ReturnType<typeof importNessie>>; at: number }
  | undefined;
export async function GET() {
  if (!process.env.NESSIE_API_KEY)
    return response(
      {
        error:
          "Nessie is not connected yet. Add the server-side API key and fictional customer ID to enable import.",
      },
      undefined,
      503,
    );
  try {
    if (!cached || Date.now() - cached.at > 60000)
      cached = { portfolio: await importNessie(), at: Date.now() };
    return response({
      portfolio: cached.portfolio,
      importedAt: new Date(cached.at).toISOString(),
    });
  } catch (error) {
    return response(
      {
        error: error instanceof Error ? error.message : "Nessie import failed.",
      },
      undefined,
      502,
    );
  }
}
