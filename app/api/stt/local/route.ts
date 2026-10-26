/**
 * Local dictation (owner, 2026-10-25): the body is one run's raw linear16
 * 16kHz mono PCM (the pcm-capture worklet's frames, concatenated); Handy
 * transcribes it with the user's selected model. See stt-local.ts.
 */
import { transcribeWithHandy } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const pcm = new Uint8Array(await req.arrayBuffer());
	const result = await transcribeWithHandy(pcm);
	if (!result.ok) return Response.json({ message: result.message }, { status: result.status });
	return Response.json({ text: result.text });
}
