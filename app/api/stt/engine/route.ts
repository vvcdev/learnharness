/** Which dictation engine this machine runs (owner, 2026-10-25): Handy
 *  when installed, else Deepgram when keyed, else none. See stt-local.ts. */
import { dictationEngine } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json({ engine: dictationEngine() });
}
