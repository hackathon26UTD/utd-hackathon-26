import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {simulationSchema,simulationFrame} from '../domain/simulation.js';
import { authenticateMcp, SCOPE } from "./customer-oauth.js";
import {
  run,
  guarded,
  reply,
  bodyJson,
  limit,
} from "./customer-connect-common.js";
import {
  buildGuide,
  customerDevices,
  deviceContext,
  RULES,
} from "./customer-assistant-context.js";
export function mcpHandler(ctx) {
  return guarded(() =>
    run(ctx, async (db) => {
      const origin = new URL(ctx.request.url).origin,
        from = ctx.request.headers.get("Origin");
      if (
        from &&
        ![origin, "https://chatgpt.com", "https://claude.ai"].includes(from)
      )
        return reply({ error: "Origin is not allowed." }, 403);
      const grant = await authenticateMcp(db, ctx.request);
      if (!grant)
        return reply(
          { error: "Connect your HomeBeacon customer account." },
          401,
          {
            "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="${SCOPE}"`,
          },
        );
      await limit(db, ctx.env, "mcp-read", grant._id, 120, 60000);
      if (ctx.request.method !== "POST")
        return reply(
          { error: "Use POST for this stateless MCP endpoint." },
          405,
          { Allow: "POST" },
        );
      const parsedBody = await bodyJson(ctx.request);
      const server = new McpServer(
        { name: "homebeacon-personal", version: "1.0.0" },
        { instructions: RULES },
      );
      const annotations = {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      };
      const wrap = (fn) => async (args) => {
        try {
          const result = await fn(args);
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result,
          };
        } catch (e) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  e.status === 404
                    ? "Device not found in your account."
                    : "Could not read these reports. Try again shortly.",
              },
            ],
          };
        }
      };
      server.registerTool(
        "homebeacon_get_build_guide",
        {
          title: "Build and register a box",
          description:
            "Get the supported hardware API, private registration link and safe setup steps. Register on HomeBeacon so credentials never enter chat.",
          inputSchema: {},
          annotations,
        },
        wrap(async () => buildGuide(origin)),
      );
      server.registerTool(
        "homebeacon_list_devices",
        {
          title: "Your boxes",
          description:
            "Read only this connected customer’s device conditions and freshness. No names, addresses, operator notes or credentials.",
          inputSchema: {},
          annotations,
        },
        wrap(async () => ({
          devices: await customerDevices(db, grant.email, ctx.env, ctx.deps),
          rules: RULES,
        })),
      );
      server.registerTool(
        "homebeacon_get_device_reports",
        {
          title: "Read a box’s reports",
          description:
            "Read the customer-visible status and at most 30 recent sensor reports for a device link returned by homebeacon_list_devices. Does not change data.",
          inputSchema: {
            device_link_id: z
              .string()
              .regex(/^[a-f0-9]{24}$/)
              .describe(
                "The id returned by homebeacon_list_devices, not a hardware key.",
              ),
          },
          annotations,
        },
        wrap(async ({ device_link_id }) =>
          deviceContext(db, grant.email, device_link_id, ctx.env, ctx.deps),
        ),
      );
      server.registerTool('homebeacon_simulation_settings', {title:'Simulation settings', description:'Get defaults and places for a fictional simulation. No live data.', inputSchema:{}, annotations}, wrap(async()=>simulationSchema()));
      server.registerTool('homebeacon_run_simulation', {title:'Run a simulation', description:'Generate a deterministic synthetic frame. No real device data or writes. Event effects are illustrative, not physical predictions.', inputSchema:{config:z.record(z.string(),z.unknown()).optional(),minute:z.number().int().min(0).max(240).default(0)}, annotations}, async({config,minute})=>{try{const value=simulationFrame(config,minute);return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value};}catch(e){return {isError:true,content:[{type:'text',text:e instanceof RangeError?e.message:'Simulation unavailable.'}]};}});
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      try {
        const response = await transport.handleRequest(ctx.request, {
          parsedBody,
        });
        response.headers.set("Cache-Control", "no-store");
        return response;
      } finally {
        await server.close();
      }
    }),
  );
}
