import { NextResponse } from "next/server";

const REACTOR_API_URL = "https://api.reactor.inc";
const MODEL_NAME = "reactor/visko-orbis-stable";

export async function POST() {
  const apiKey = process.env.REACTOR_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "REACTOR_API_KEY is not configured" },
      { status: 500 },
    );
  }

  const response = await fetch(`${REACTOR_API_URL}/tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Reactor-API-Key": apiKey,
    },
    body: JSON.stringify({
      expires_after: 3600,
      authorization_details: [
        {
          type: "session",
          resources: { models: { match: [MODEL_NAME] } },
          constraints: { max_sessions: 1 },
        },
      ],
    }),
    cache: "no-store",
  });

  const text = await response.text();
  if (!response.ok) {
    return NextResponse.json(
      { error: `Reactor token request failed (${response.status}): ${text}` },
      { status: response.status },
    );
  }

  const result = JSON.parse(text) as { jwt?: string };
  if (!result.jwt) {
    return NextResponse.json({ error: "Reactor returned no JWT" }, { status: 502 });
  }

  return NextResponse.json(
    { jwt: result.jwt },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
