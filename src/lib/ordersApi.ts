/** A problem the person running the command should see (as opposed to an unexpected failure, which is logged). */
export class OrderError extends Error {}

type Reply<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

const TIMEOUT_MS = 10_000;

/** Is this an address we're happy to send the secret to over plain http? */
function isLocal(url: URL): boolean {
	return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}

/**
 * Talks to the bot_orders_* functions in the website's Supabase database through Supabase's built-in
 * REST API. It authenticates with the project's *public* anon key (the one the website already ships
 * to browsers) plus this bot's own BOT_API_SECRET, which the database functions check. The service-role
 * key is never used here — the functions only allow listing/reading/creating/updating orders.
 * See supabase/bot-orders.sql.
 */
export class OrdersApi {
	private readonly base: URL;

	constructor(
		url: string,
		private readonly anonKey: string,
		private readonly secret: string,
		private readonly fetchImpl: typeof fetch = fetch
	) {
		this.base = new URL(url);
		if (this.base.protocol !== "https:" && !(this.base.protocol === "http:" && isLocal(this.base))) {
			throw new Error("SUPABASE_URL must be https (the bot secret is sent with every request)");
		}
	}

	/** Calls `public.<fn>` and returns its `data`, throwing OrderError for problems the admin should read. */
	async call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
		const headers: Record<string, string> = { "Content-Type": "application/json", apikey: this.anonKey };
		// Legacy anon keys are JWTs and also go in Authorization; the newer sb_publishable_ keys are not JWTs and must not.
		if (this.anonKey.startsWith("eyJ")) headers["Authorization"] = `Bearer ${this.anonKey}`;

		const res = await this.fetchImpl(new URL(`/rest/v1/rpc/${fn}`, this.base), {
			method: "POST",
			headers,
			body: JSON.stringify({ p_secret: this.secret, ...args }),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});

		let body: unknown;
		try {
			body = await res.json();
		} catch {
			throw new Error(`orders API ${fn} returned HTTP ${res.status} with a non-JSON body`);
		}

		if (!res.ok) {
			const code = (body as { code?: string })?.code;
			if (code === "PGRST202" || res.status === 404) throw new Error(`${fn} doesn't exist in the database — run supabase/bot-orders.sql in the Supabase SQL editor`);
			throw new Error(`orders API ${fn} failed: HTTP ${res.status}${code ? ` (${code})` : ""}`);
		}

		const reply = body as Reply<T>;
		if (reply?.ok === true) return reply.data;
		if (reply?.ok === false) {
			if (reply.error.code === "UNAUTHORIZED") {
				throw new Error("the database rejected BOT_API_SECRET — run `npm run -s orders:secret` and paste its output into the Supabase SQL editor (and check .env)");
			}
			throw new OrderError(reply.error.message);
		}
		throw new Error(`orders API ${fn} returned an unexpected response`);
	}
}

let api: OrdersApi | null | undefined;

/** Returns null when the orders settings aren't in .env, so order commands can say so instead of crashing the bot. */
export function getOrdersApi(): OrdersApi | null {
	if (api !== undefined) return api;
	const url = process.env["SUPABASE_URL"]?.trim();
	const anonKey = process.env["SUPABASE_ANON_KEY"]?.trim();
	const secret = process.env["BOT_API_SECRET"]?.trim();
	if (!url || !anonKey || !secret) return (api = null);
	try {
		api = new OrdersApi(url, anonKey, secret);
	} catch (err) {
		console.error(`Orders disabled: ${(err as Error).message}`);
		api = null;
	}
	return api;
}

/** Test seam: swap in a fake (or null) without touching the environment. */
export function setOrdersApiForTesting(fake: OrdersApi | null): void {
	api = fake;
}
