import { claudeCodeStatus } from "@/src/server";

export const dynamic = "force-dynamic";

export function GET() {
	const status = claudeCodeStatus();
	return Response.json({
		loggedIn: status.loggedIn,
		subscription: status.subscription,
		hint: status.loggedIn ? null : "Not signed in. In Terminal, run claude auth login, then reload.",
	});
}
