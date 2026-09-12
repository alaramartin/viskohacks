import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

// Spike-only: serves a seed frame from docs/spike/seeds/ so seeds can be
// swapped without touching the app bundle. The product fetches seeds from the
// backend's /api/imagery instead.
export const runtime = "nodejs";

const SEEDS_ROOT = path.resolve(process.cwd(), "..", "docs", "spike", "seeds");

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "spike route is dev-only" }, { status: 404 });
  }

  const name = new URL(request.url).searchParams.get("name") ?? "";
  if (!/^[a-zA-Z0-9._-]+\.(jpg|jpeg|png)$/.test(name)) {
    return NextResponse.json({ error: "bad seed name" }, { status: 400 });
  }

  try {
    const bytes = await readFile(path.join(SEEDS_ROOT, name));
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": name.endsWith(".png") ? "image/png" : "image/jpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: `no seed named ${name}` }, { status: 404 });
  }
}
