import { PrismaClient } from "@prisma/client";
import ExtendedClient from "../structure/ExtendedClient";
import { buildVipReminderDm } from "../ui/vip";

export const REMINDER_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_WINDOW_MS = REMINDER_DAYS * DAY_MS;
const MAX_FUTURE_MS = 10 * 365 * DAY_MS;
const SWEEP_EVERY_MS = 60 * 60 * 1000;

export type VipRecord = { discordId: string; expiresAt: number; grantedBy: string; grantedAt: number };

export class VipInputError extends Error {}

/**
 * Parses an admin-supplied expiry: `YYYY-MM-DD` (expires at the end of that day, UTC) or `<n>d` / `<n>w`
 * (that many days/weeks from now). Returns epoch milliseconds, and throws VipInputError with a
 * human-readable reason when it's malformed, in the past, or implausibly far away.
 */
export function parseExpiry(input: string, now = Date.now()): number {
	const text = input.trim().toLowerCase();
	let expiresAt: number;

	const relative = /^(\d{1,4})\s*([dw])$/.exec(text);
	const absolute = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);

	if (relative) {
		expiresAt = now + Number(relative[1]) * (relative[2] === "w" ? 7 : 1) * DAY_MS;
	} else if (absolute) {
		const [year, month, day] = [Number(absolute[1]), Number(absolute[2]), Number(absolute[3])];
		const date = new Date(Date.UTC(year, month - 1, day, 23, 59, 59));
		// Date.UTC silently rolls invalid dates over (Feb 31 → Mar 3), so confirm it round-trips.
		if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
			throw new VipInputError(`"${input}" isn't a real calendar date.`);
		expiresAt = date.getTime();
	} else {
		throw new VipInputError("Use a date like `2026-12-31`, or a length like `30d` / `4w`.");
	}

	if (expiresAt <= now) throw new VipInputError("That expiry is already in the past.");
	if (expiresAt - now > MAX_FUTURE_MS) throw new VipInputError("That expiry is more than 10 years away — check for a typo.");
	return expiresAt;
}

const toRecord = (row: { discordId: string; expiresAt: bigint; grantedBy: string; grantedAt: bigint }): VipRecord => ({
	discordId: row.discordId,
	expiresAt: Number(row.expiresAt),
	grantedBy: row.grantedBy,
	grantedAt: Number(row.grantedAt),
});

export const isActive = (vip: VipRecord, now = Date.now()) => vip.expiresAt > now;

/** Grants or updates a member's VIP expiry. A grant already inside the reminder window doesn't trigger an instant reminder. */
export async function giveVip(prisma: PrismaClient, discordId: string, expiresAt: number, grantedBy: string, now = Date.now()): Promise<VipRecord> {
	const insideWindow = expiresAt - now <= REMINDER_WINDOW_MS;
	const row = await prisma.vips.upsert({
		where: { discordId },
		create: { discordId, expiresAt: BigInt(expiresAt), grantedBy, grantedAt: BigInt(now), reminderSentAt: insideWindow ? BigInt(now) : null },
		update: { expiresAt: BigInt(expiresAt), grantedBy, grantedAt: BigInt(now), reminderSentAt: insideWindow ? BigInt(now) : null },
	});
	return toRecord(row);
}

export async function revokeVip(prisma: PrismaClient, discordId: string): Promise<boolean> {
	const { count } = await prisma.vips.deleteMany({ where: { discordId } });
	return count > 0;
}

export async function getVip(prisma: PrismaClient, discordId: string): Promise<VipRecord | null> {
	const row = await prisma.vips.findUnique({ where: { discordId } });
	return row ? toRecord(row) : null;
}

export async function listActiveVips(prisma: PrismaClient, now = Date.now()): Promise<VipRecord[]> {
	const rows = await prisma.vips.findMany({ where: { expiresAt: { gt: BigInt(now) } }, orderBy: { expiresAt: "asc" } });
	return rows.map(toRecord);
}

/**
 * DMs every VIP whose membership ends within REMINDER_DAYS, once per expiry date. Each member is "claimed"
 * with a conditional update before the DM goes out, so two overlapping sweeps can't double-send, and a
 * member with DMs closed isn't retried every hour.
 */
export async function sendDueVipReminders(client: ExtendedClient, now = Date.now()): Promise<number> {
	const due = await client.prisma.vips.findMany({
		where: { reminderSentAt: null, expiresAt: { gt: BigInt(now), lte: BigInt(now + REMINDER_WINDOW_MS) } },
	});

	let sent = 0;
	for (const vip of due) {
		const claimed = await client.prisma.vips.updateMany({
			where: { discordId: vip.discordId, reminderSentAt: null },
			data: { reminderSentAt: BigInt(now) },
		});
		if (claimed.count === 0) continue;

		try {
			const user = await client.users.fetch(vip.discordId);
			await user.send(buildVipReminderDm(client, Number(vip.expiresAt)));
			sent++;
		} catch (err) {
			console.warn(`VIP reminder: couldn't DM ${vip.discordId} (DMs closed or user gone).`, err instanceof Error ? err.message : err);
		}
	}
	return sent;
}

let started = false;

/** Runs a sweep shortly after startup (catching anything missed while offline), then hourly. */
export function startVipReminders(client: ExtendedClient): void {
	if (started) return;
	started = true;

	let running = false;
	const sweep = async () => {
		if (running) return;
		running = true;
		try {
			const sent = await sendDueVipReminders(client);
			if (sent > 0) console.log(`VIP reminder: sent ${sent} DM(s).`);
		} catch (err) {
			console.error("VIP reminder sweep failed:", err);
		} finally {
			running = false;
		}
	};

	setTimeout(sweep, 10_000);
	setInterval(sweep, SWEEP_EVERY_MS);
}
