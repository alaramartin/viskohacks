import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

// Spike-only. Writes frames and timing logs from the browser to disk so the
// run can be inspected afterwards (docs/reactor-findings.md). Delete this
// route once Phase 1 is signed off — nothing in the product should be able to
// write arbitrary files.
export const runtime = "nodejs";

const RUNS_ROOT = path.resolve(process.cwd(), "..", "docs", "spike", "runs");

function safeSegment(value: string, fallback: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
  return cleaned || fallback;
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "spike route is dev-only" }, { status: 404 });
  }

  const body = (await request.json()) as {
    run?: string;
    name?: string;
    dataUrl?: string;
    text?: string;
  };

  const run = safeSegment(body.run ?? "", "run");
  const name = safeSegment(body.name ?? "", "capture");
  const dir = path.join(RUNS_ROOT, run);
  await mkdir(dir, { recursive: true });

  if (body.dataUrl) {
    const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(body.dataUrl);
    if (!match) {
      return NextResponse.json({ error: "unsupported dataUrl" }, { status: 400 });
    }
    const extension = match[1] === "jpeg" ? "jpg" : "png";
    const file = path.join(dir, `${name}.${extension}`);
    await writeFile(file, Buffer.from(match[2], "base64"));
    return NextResponse.json({ written: file });
  }

  if (typeof body.text === "string") {
    const file = path.join(dir, `${name}.txt`);
    await writeFile(file, body.text, "utf8");
    return NextResponse.json({ written: file });
  }

  return NextResponse.json({ error: "nothing to write" }, { status: 400 });
}
