import { ActivityType, ChannelType, MessageFlags, type TextChannel } from "discord.js";
import type ExtendedClient from "../structure/ExtendedClient";
import { buildAnnouncement, buildStatusBoard, type Announcement } from "../ui/shopStatus";

export const QUEUE_LEVELS = ["low", "medium", "high", "full"] as const;
export type QueueLevel = (typeof QUEUE_LEVELS)[number];

export type Sale = { state: "off" | "live" | "ending"; name?: string; details?: string; endsAt?: number };

export type ShopState = {
	store: "open" | "closed";
	/** Shown under the store heading, e.g. why we're closed or when we're back. */
	storeNote?: string;
	queue: QueueLevel | "off";
	sale: Sale;
	/** Free-text line on the board (cleared with /shop note). */
	note?: string;
	updatedAt: number;
};

const STATE_KEY = "shopState";
const TRACKED_KEY = "shopTrackedUsers";
const MESSAGE_KEY = "shopStatusMessageId";

const MAX_LINES = 6;
const MIN_REFRESH_GAP_MS = 30_000;
const DEBOUNCE_MS = 5_000;

// ── persistence (the bot's own key/value `config` table; no schema change) ───────────────────────

async function readKey(client: ExtendedClient, key: string): Promise<string | null> {
	return (await client.prisma.config.findUnique({ where: { key } }))?.value ?? null;
}

async function writeKey(client: ExtendedClient, key: string, value: string): Promise<void> {
	await client.prisma.config.upsert({ where: { key }, create: { key, value }, update: { value } });
}

const isQueue = (v: unknown): v is QueueLevel | "off" => v === "off" || (QUEUE_LEVELS as readonly unknown[]).includes(v);

export async function loadState(client: ExtendedClient): Promise<ShopState | null> {
	const raw = await readKey(client, STATE_KEY);
	if (!raw) return null;
	try {
		const s = JSON.parse(raw) as Partial<ShopState>;
		const sale = (s.sale ?? { state: "off" }) as Sale;
		if ((s.store !== "open" && s.store !== "closed") || !isQueue(s.queue) || !["off", "live", "ending"].includes(sale.state)) return null;
		return { store: s.store, storeNote: s.storeNote, queue: s.queue, sale, note: s.note, updatedAt: Number(s.updatedAt) || Date.now() };
	} catch {
		return null;
	}
}

/** Applies `change` to the stored state (starting from a closed shop if none exists yet) and saves it. */
export async function updateState(client: ExtendedClient, change: (s: ShopState) => void): Promise<ShopState> {
	const state: ShopState = (await loadState(client)) ?? { store: "closed", queue: "off", sale: { state: "off" }, updatedAt: Date.now() };
	change(state);
	state.updatedAt = Date.now();
	await writeKey(client, STATE_KEY, JSON.stringify(state));
	return state;
}

export async function getTracked(client: ExtendedClient): Promise<string[]> {
	try {
		const list = JSON.parse((await readKey(client, TRACKED_KEY)) ?? "[]") as unknown;
		return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
	} catch {
		return [];
	}
}

export async function setTracked(client: ExtendedClient, userId: string, tracked: boolean): Promise<string[]> {
	const set = new Set(await getTracked(client));
	if (tracked) set.add(userId);
	else set.delete(userId);
	const list = [...set].slice(0, 10);
	await writeKey(client, TRACKED_KEY, JSON.stringify(list));
	return list;
}

// ── "what are we working on right now", from Discord presence ────────────────────────────────────

/** Creative apps worth showing on a public board. Anything else (games, Spotify, …) is ignored unless `showOtherActivities`. */
const APPS: Array<[RegExp, string, string]> = [
	[/photoshop/i, "🎨", "Photoshop"],
	[/after ?effects/i, "🎞️", "After Effects"],
	[/premiere/i, "🎬", "Premiere Pro"],
	[/illustrator/i, "✏️", "Illustrator"],
	[/lightroom/i, "📷", "Lightroom"],
	[/blender/i, "🧊", "Blender"],
	[/cinema ?4d/i, "🌀", "Cinema 4D"],
	[/davinci|resolve/i, "🎥", "DaVinci Resolve"],
	[/figma/i, "🖌️", "Figma"],
	[/substance/i, "🧪", "Substance"],
	[/\bmaya\b/i, "🗿", "Maya"],
	[/3ds ?max/i, "📐", "3ds Max"],
	[/affinity/i, "🖼️", "Affinity"],
	[/krita|procreate|clip studio/i, "🖍️", "Krita"],
];

export type PresenceEntry = {
	userId: string;
	status: string;
	activities: ReadonlyArray<{ type: number; name: string; state?: string | null; emoji?: { name: string | null; id: string | null } | null }>;
};

/** Custom-status text is user-written and goes on a public board: flatten it and defuse mentions/markdown. */
export function cleanStatusText(text: string): string {
	return text
		.replace(/[\r\n]+/g, " ")
		.replace(/[<>]/g, "")
		.replace(/@/g, "@​")
		.replace(/([\\*_~|`])/g, "\\$1")
		.trim()
		.slice(0, 100);
}

/**
 * Turns tracked members' presences into board lines. Only the app's *name* is ever used — never the rich-presence
 * details/state, which can include file or project names (i.e. customers' work).
 */
export function activityLines(entries: PresenceEntry[], opts: { showOtherActivities?: boolean } = {}): string[] {
	const lines: string[] = [];
	for (const e of entries) {
		if (e.status === "offline" || e.status === "invisible") continue;
		const seen = new Set<string>();

		for (const a of e.activities) {
			if (a.type === ActivityType.Playing || a.type === ActivityType.Competing) {
				const app = APPS.find(([re]) => re.test(a.name));
				if (app) {
					if (!seen.has(app[2])) lines.push(`${app[1]} <@${e.userId}> is working in **${app[2]}**`);
					seen.add(app[2]);
				} else if (opts.showOtherActivities && !seen.has(a.name)) {
					lines.push(`🛠️ <@${e.userId}> is using **${cleanStatusText(a.name)}**`);
					seen.add(a.name);
				}
			} else if (a.type === ActivityType.Streaming) {
				lines.push(`📡 <@${e.userId}> is live: **${cleanStatusText(a.name)}**`);
			} else if (a.type === ActivityType.Custom && a.state?.trim()) {
				const emoji = a.emoji && !a.emoji.id && a.emoji.name ? `${a.emoji.name} ` : "";
				lines.push(`💬 <@${e.userId}>: ${emoji}${cleanStatusText(a.state)}`);
			}
		}
	}
	return lines.slice(0, MAX_LINES);
}

export async function currentActivityLines(client: ExtendedClient): Promise<string[]> {
	const cfg = client.config.shopStatus;
	if (cfg?.trackPresence === false) return [];
	const guild = client.guilds.cache.get(client.config.guildId);
	if (!guild) return [];

	const entries: PresenceEntry[] = [];
	for (const userId of await getTracked(client)) {
		const presence = guild.presences.cache.get(userId);
		if (presence) entries.push({ userId, status: presence.status, activities: presence.activities });
	}
	return activityLines(entries, { showOtherActivities: cfg?.showOtherActivities });
}

// ── posting ──────────────────────────────────────────────────────────────────────────────────────

async function statusChannel(client: ExtendedClient): Promise<TextChannel | null> {
	const id = client.config.shopStatus?.channelId;
	if (!id) return null;
	const channel = await client.channels.fetch(id).catch(() => null);
	if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) return null;
	return channel as TextChannel;
}

// Everything that touches the board message runs one at a time, so two quick changes can't post it twice.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(task: () => Promise<T>): Promise<T> => {
	const run = queue.then(task, task);
	queue = run.catch(() => null);
	return run;
};

let lastSignature = "";
let lastRefreshAt = 0;

export type BoardResult = "updated" | "posted" | "no-channel" | "no-state";

/**
 * Creates or edits the single status board message in the status channel. The banner/logo are only re-uploaded when
 * `reupload` is set (startup, /shop refresh) — routine live-activity edits leave the existing images in place.
 */
export function refreshBoard(client: ExtendedClient, opts: { reupload?: boolean } = {}): Promise<BoardResult> {
	return serial(async () => {
		const state = await loadState(client);
		if (!state) return "no-state";
		const channel = await statusChannel(client);
		if (!channel) return "no-channel";

		const lines = await currentActivityLines(client);
		const payload = buildStatusBoard(client, state, lines);
		lastSignature = JSON.stringify([state, lines]);
		lastRefreshAt = Date.now();

		const storedId = await readKey(client, MESSAGE_KEY);
		const existing = storedId ? await channel.messages.fetch(storedId).catch(() => null) : null;
		if (existing) {
			await existing.edit({
				components: payload.components,
				flags: MessageFlags.IsComponentsV2,
				allowedMentions: { parse: [] },
				...(opts.reupload ? { files: payload.files, attachments: [] } : {}),
			});
			return "updated";
		}

		const sent = await channel.send({ components: payload.components, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] }, files: payload.files });
		await writeKey(client, MESSAGE_KEY, sent.id);
		return "posted";
	});
}

/** Posts a one-off notice ("Store is now open", "Sale started", …). Returns false if it couldn't be sent. */
export function postAnnouncement(client: ExtendedClient, announcement: Announcement, opts: { ping?: boolean } = {}): Promise<boolean> {
	return serial(async () => {
		const channel = await statusChannel(client);
		if (!channel) return false;
		const roleId = opts.ping === false ? undefined : client.config.shopStatus?.pingRoleId || undefined;
		await channel.send(buildAnnouncement(client, announcement, roleId));
		return true;
	});
}

// ── live updates ─────────────────────────────────────────────────────────────────────────────────

let timer: NodeJS.Timeout | undefined;

/** Presence changes arrive in bursts, so wait a moment, stay under a minimum gap between edits, and skip no-op edits. */
export function scheduleBoardRefresh(client: ExtendedClient): void {
	if (timer) return;
	const wait = Math.max(DEBOUNCE_MS, lastRefreshAt + MIN_REFRESH_GAP_MS - Date.now());
	timer = setTimeout(async () => {
		timer = undefined;
		try {
			const state = await loadState(client);
			if (!state) return;
			if (JSON.stringify([state, await currentActivityLines(client)]) === lastSignature) return;
			await refreshBoard(client);
		} catch (err) {
			console.error("Shop status: couldn't refresh the board:", err);
		}
	}, wait);
	timer.unref();
}

/** Ends a sale automatically once its end time passes. */
export async function expireSaleIfDue(client: ExtendedClient, now = Date.now()): Promise<boolean> {
	const state = await loadState(client);
	if (!state || state.sale.state === "off" || !state.sale.endsAt || state.sale.endsAt > now) return false;

	const ended = { ...state.sale };
	await updateState(client, (s) => {
		s.sale = { state: "off" };
	});
	await refreshBoard(client).catch((err) => console.error("Shop status: board refresh failed:", err));
	await postAnnouncement(client, { type: "sale", state: "off", name: ended.name }).catch((err) => console.error("Shop status: announcement failed:", err));
	return true;
}

/** Called once the bot is ready: refresh the board with fresh presence, then watch for sales that have ended. */
export function startShopStatus(client: ExtendedClient): void {
	if (!client.config.shopStatus?.channelId) return;
	const tick = () => expireSaleIfDue(client).catch((err) => console.error("Shop status: sale expiry check failed:", err));

	refreshBoard(client, { reupload: true }).catch((err) => console.error("Shop status: couldn't refresh the board on startup:", err));
	tick();
	setInterval(tick, 60_000).unref();
}
