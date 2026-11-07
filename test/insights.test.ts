import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "../app/api/insights/route";
import { demoPortfolio, defaultScenario } from "../lib/demo";

function request(extra = {}) {
  return new NextRequest("http://localhost/api/insights", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      origin: "http://localhost",
      host: "localhost",
    },
    body: JSON.stringify({
      portfolio: demoPortfolio,
      scenario: { ...defaultScenario, ...extra },
    }),
  });
}

test("incomplete AI output falls back to the complete calculated summary", async () => {
  const previousFetch = globalThis.fetch,
    previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-only";
  globalThis.fetch = async () =>
    Response.json({
      candidates: [
        {
          finishReason: "MAX_TOKENS",
          content: { parts: [{ text: "The forecast reaches" }] },
        },
      ],
    });
  try {
    const res = await POST(request({ movingCents: 110100 }));
    const data = await res.json();
    assert.equal(data.source, "calculation");
    assert.ok(data.text.includes("first falls below zero"));
    assert.ok(data.note.includes("unavailable"));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test("completed AI output is reused for identical facts without sharing identities", async () => {
  const previousFetch = globalThis.fetch,
    previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-only";
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    const body = String(init?.body);
    assert.ok(!body.includes(demoPortfolio.name));
    assert.ok(!body.includes(demoPortfolio.accounts[0].id));
    return Response.json({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [
              { text: "Check the first payday before committing to the move." },
            ],
          },
        },
      ],
    });
  };
  try {
    const first = await (await POST(request({ movingCents: 110200 }))).json();
    const second = await (await POST(request({ movingCents: 110200 }))).json();
    assert.equal(first.source, "gemini");
    assert.equal(second.text, first.text);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});
