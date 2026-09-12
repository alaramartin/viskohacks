import { NextResponse } from "next/server";

const REACTOR_API_URL = "https://api.reactor.inc";
const DEFAULT_MODEL_NAME = "reactor/visko-orbis-stable";

// The account's `concurrent_sessions_per_model` quota is 1 (spike Q3), and it
// overrides whatever this asks for — a token minted with max_sessions: 3 still
// gets 429 quota_exceeded on the second connect. Ask for 1 so the token's
// scope matches reality. Raise this only once Reactor raises the quota.
const DEFAULT_MAX_SESSIONS = 1;

type TokenRequest = {
  model?: string;
  maxSessions?: number;
};

export async function POST(request: Request) {
  const apiKey = process.env.REACTOR_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "REACTOR_API_KEY is not configured" },
      { status: 500 },
    );
  }

  // The starter posted an empty body; keep that working.
  let body: TokenRequest = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text) as TokenRequest;
  } catch {
    body = {};
  }

  const modelName = body.model?.trim() || DEFAULT_MODEL_NAME;
  const maxSessions =
    Number.isInteger(body.maxSessions) && (body.maxSessions as number) > 0
      ? (body.maxSessions as number)
      : DEFAULT_MAX_SESSIONS;

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
          resources: { models: { match: [modelName] } },
          constraints: { max_sessions: maxSessions },
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
    { jwt: result.jwt, model: modelName, maxSessions },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
