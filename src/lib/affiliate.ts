import { Prisma, PrismaClient } from "@prisma/client";
import type ExtendedClient from "../structure/ExtendedClient";

/** A problem the person running the command should read (as opposed to an unexpected failure, which is logged). */
export class AffiliateError extends Error {}

export const CODE_RULE = "Codes are 3–20 characters: letters, numbers, `-` and `_`, starting with a letter or number.";
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,19}$/;
const MAX_CENTS = 100_000_000; // $1,000,000 — keeps every amount comfortably inside a 32-bit Int
const NOT_AFFILIATE = "That member isn't an affiliate.";

export type AffiliateRecord = {
	discordId: string;
	code: string;
	balanceCents: number;
	earnedCents: number;
	withdrawnCents: number;
	createdBy: string;
	createdAt: number;
};

export type WithdrawalStatus = "pending" | "paid" | "rejected";

export type WithdrawalRecord = {
	id: number;
	affiliateId: string;
	amountCents: number;
	payoutDetails: string;
	status: WithdrawalStatus;
	requestedAt: number;
	resolvedAt: number | null;
	resolvedBy: string | null;
	note: string | null;
	payoutChannelId: string | null;
	payoutMessageId: string | null;
};

export type LedgerRecord = {
	id: number;
	affiliateId: string;
	type: string;
	amountCents: number;
	balanceAfter: number;
	note: string | null;
	actor: string;
	createdAt: number;
};

export type ReferralRecord = { memberId: string; affiliateId: string; usedAt: number };

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────

export function formatMoney(cents: number): string {
	const text = (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	return `${cents < 0 ? "-" : ""}$${text}`;
}

export function signedMoney(cents: number): string {
	return `${cents < 0 ? "−" : "+"}${formatMoney(Math.abs(cents))}`;
}

/** Converts a dollar amount typed by an admin/affiliate into whole cents, rejecting nonsense. */
export function dollarsToCents(dollars: number): number {
	if (!Number.isFinite(dollars)) throw new AffiliateError("That isn't a valid amount.");
	const cents = Math.round(dollars * 100);
	if (cents < 0 || cents > MAX_CENTS) throw new AffiliateError(`Amounts must be between $0.00 and ${formatMoney(MAX_CENTS)}.`);
	return cents;
}

export function normalizeCode(input: string): string {
	const code = input.trim().toUpperCase();
	if (!CODE_PATTERN.test(code)) throw new AffiliateError(CODE_RULE);
	return code;
}

export function affiliateSettings(client: ExtendedClient) {
	const cfg = client.config.affiliate ?? {};
	return {
		roleId: cfg.roleId?.trim() || undefined,
		payoutChannelId: cfg.payoutChannelId?.trim() || undefined,
		minWithdrawalCents: Math.round((cfg.minWithdrawalUsd ?? 10) * 100),
	};
}

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

type AffiliateRow = { discordId: string; code: string; balanceCents: number; earnedCents: number; withdrawnCents: number; createdBy: string; createdAt: bigint };
const toAffiliate = (r: AffiliateRow): AffiliateRecord => ({
	discordId: r.discordId,
	code: r.code,
	balanceCents: r.balanceCents,
	earnedCents: r.earnedCents,
	withdrawnCents: r.withdrawnCents,
	createdBy: r.createdBy,
	createdAt: Number(r.createdAt),
});

type WithdrawalRow = {
	id: number;
	affiliateId: string;
	amountCents: number;
	payoutDetails: string;
	status: string;
	requestedAt: bigint;
	resolvedAt: bigint | null;
	resolvedBy: string | null;
	note: string | null;
	payoutChannelId: string | null;
	payoutMessageId: string | null;
};
const toWithdrawal = (r: WithdrawalRow): WithdrawalRecord => ({
	id: r.id,
	affiliateId: r.affiliateId,
	amountCents: r.amountCents,
	payoutDetails: r.payoutDetails,
	status: r.status as WithdrawalStatus,
	requestedAt: Number(r.requestedAt),
	resolvedAt: r.resolvedAt === null ? null : Number(r.resolvedAt),
	resolvedBy: r.resolvedBy,
	note: r.note,
	payoutChannelId: r.payoutChannelId,
	payoutMessageId: r.payoutMessageId,
});

// ── affiliates ───────────────────────────────────────────────────────────────────────────────────

export async function getAffiliate(prisma: PrismaClient, discordId: string): Promise<AffiliateRecord | null> {
	const row = await prisma.affiliates.findUnique({ where: { discordId } });
	return row ? toAffiliate(row) : null;
}

export async function getAffiliateByCode(prisma: PrismaClient, code: string): Promise<AffiliateRecord | null> {
	const row = await prisma.affiliates.findUnique({ where: { code } });
	return row ? toAffiliate(row) : null;
}

/** Builds a free code from a username (`Sarge` → `SARGE`, then `SARGE2`, `SARGE3`, …). */
export async function suggestCode(prisma: PrismaClient, username: string): Promise<string> {
	const base = username.toUpperCase().replace(/[^A-Z0-9_-]/g, "").replace(/^[_-]+/, "").slice(0, 16).padEnd(3, "X");
	for (let n = 1; n < 100; n++) {
		const candidate = n === 1 ? base : `${base}${n}`;
		if (!(await prisma.affiliates.findUnique({ where: { code: candidate } }))) return candidate;
	}
	throw new AffiliateError("Couldn't find a free code automatically — pass one in the `code` option.");
}

export async function createAffiliate(prisma: PrismaClient, discordId: string, code: string, createdBy: string, now = Date.now()): Promise<AffiliateRecord> {
	try {
		return toAffiliate(await prisma.affiliates.create({ data: { discordId, code, createdBy, createdAt: BigInt(now) } }));
	} catch (err) {
		if (!isUniqueViolation(err)) throw err;
		throw new AffiliateError((await getAffiliate(prisma, discordId)) ? "That member is already an affiliate." : `The code \`${code}\` is already taken.`);
	}
}

/** Removes an affiliate and detaches everyone using their code. History (ledger, past withdrawals) is kept. */
export async function removeAffiliate(prisma: PrismaClient, discordId: string): Promise<AffiliateRecord | null> {
	const row = await prisma.affiliates.findUnique({ where: { discordId } });
	if (!row) return null;
	if ((await prisma.affiliateWithdrawals.count({ where: { affiliateId: discordId, status: "pending" } })) > 0)
		throw new AffiliateError("They have a withdrawal waiting for approval — approve or reject it first.");
	await prisma.$transaction([prisma.affiliateReferrals.deleteMany({ where: { affiliateId: discordId } }), prisma.affiliates.delete({ where: { discordId } })]);
	return toAffiliate(row);
}

export async function changeCode(prisma: PrismaClient, discordId: string, code: string): Promise<AffiliateRecord> {
	try {
		return toAffiliate(await prisma.affiliates.update({ where: { discordId }, data: { code } }));
	} catch (err) {
		if (isUniqueViolation(err)) throw new AffiliateError(`The code \`${code}\` is already taken.`);
		if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") throw new AffiliateError(NOT_AFFILIATE);
		throw err;
	}
}

export type BalanceAction = "add" | "remove" | "set";

/**
 * Changes an affiliate's balance and records it in the ledger.
 * - `add` / `remove` move the balance and lifetime earnings together (earning money / clawing it back).
 * - `set` fixes the balance to an exact figure without touching lifetime earnings.
 */
export async function adjustBalance(
	prisma: PrismaClient,
	discordId: string,
	action: BalanceAction,
	amountCents: number,
	actor: string,
	note?: string | null,
	now = Date.now()
): Promise<{ affiliate: AffiliateRecord; delta: number }> {
	if (!Number.isInteger(amountCents) || amountCents < 0 || amountCents > MAX_CENTS) throw new AffiliateError("That isn't a valid amount.");
	if (action !== "set" && amountCents === 0) throw new AffiliateError("The amount must be more than $0.00.");

	return prisma.$transaction(async (tx) => {
		const row = await tx.affiliates.findUnique({ where: { discordId } });
		if (!row) throw new AffiliateError(NOT_AFFILIATE);

		let delta: number;
		if (action === "add") delta = amountCents;
		else if (action === "remove") {
			if (amountCents > row.balanceCents) throw new AffiliateError(`Their balance is only ${formatMoney(row.balanceCents)}.`);
			delta = -amountCents;
		} else delta = amountCents - row.balanceCents;

		if (delta === 0) return { affiliate: toAffiliate(row), delta };

		const balanceAfter = row.balanceCents + delta;
		if (balanceAfter > MAX_CENTS) throw new AffiliateError(`A balance can't go above ${formatMoney(MAX_CENTS)}.`);
		const earnedAfter = action === "set" ? row.earnedCents : Math.max(0, row.earnedCents + delta);

		const updated = await tx.affiliates.update({ where: { discordId }, data: { balanceCents: balanceAfter, earnedCents: earnedAfter } });
		await tx.affiliateLedger.create({
			data: {
				affiliateId: discordId,
				type: action === "add" ? "credit" : action === "remove" ? "debit" : "adjustment",
				amountCents: delta,
				balanceAfter,
				note: note?.trim() || null,
				actor,
				createdAt: BigInt(now),
			},
		});
		return { affiliate: toAffiliate(updated), delta };
	});
}

export type AffiliateSummary = AffiliateRecord & { referrals: number };

export async function listAffiliates(prisma: PrismaClient): Promise<AffiliateSummary[]> {
	const [rows, counts] = await Promise.all([
		prisma.affiliates.findMany({ orderBy: [{ earnedCents: "desc" }, { createdAt: "asc" }] }),
		prisma.affiliateReferrals.groupBy({ by: ["affiliateId"], _count: { _all: true } }),
	]);
	const byId = new Map(counts.map((c) => [c.affiliateId, c._count._all]));
	return rows.map((r) => ({ ...toAffiliate(r), referrals: byId.get(r.discordId) ?? 0 }));
}

export const referralCount = (prisma: PrismaClient, affiliateId: string) => prisma.affiliateReferrals.count({ where: { affiliateId } });

/** 1 = the top earner. */
export async function earnedRank(prisma: PrismaClient, earnedCents: number): Promise<number> {
	return (await prisma.affiliates.count({ where: { earnedCents: { gt: earnedCents } } })) + 1;
}

export async function searchCodes(prisma: PrismaClient, term: string, limit = 25): Promise<string[]> {
	const rows = await prisma.affiliates.findMany({ where: { code: { contains: term.trim().toUpperCase() } }, orderBy: { code: "asc" }, take: limit, select: { code: true } });
	return rows.map((r) => r.code);
}

// ── referrals (members using a code) ─────────────────────────────────────────────────────────────

export async function listReferrals(prisma: PrismaClient, affiliateId: string, limit = 10): Promise<ReferralRecord[]> {
	const rows = await prisma.affiliateReferrals.findMany({ where: { affiliateId }, orderBy: { usedAt: "desc" }, take: limit });
	return rows.map((r) => ({ memberId: r.memberId, affiliateId: r.affiliateId, usedAt: Number(r.usedAt) }));
}

/** Who a member is currently supporting, or null. */
export async function getUsedCode(prisma: PrismaClient, memberId: string): Promise<{ affiliate: AffiliateRecord; usedAt: number } | null> {
	const referral = await prisma.affiliateReferrals.findUnique({ where: { memberId } });
	if (!referral) return null;
	const affiliate = await getAffiliate(prisma, referral.affiliateId);
	return affiliate ? { affiliate, usedAt: Number(referral.usedAt) } : null;
}

/** Points a member at a creator code. A member supports one affiliate at a time — using a new code switches. */
export async function useCode(prisma: PrismaClient, memberId: string, rawCode: string, now = Date.now()): Promise<{ affiliate: AffiliateRecord; previous: AffiliateRecord | null }> {
	const code = normalizeCode(rawCode);
	const affiliate = await getAffiliateByCode(prisma, code);
	if (!affiliate) throw new AffiliateError(`Nobody has the code \`${code}\`. Double-check the spelling.`);
	if (affiliate.discordId === memberId) throw new AffiliateError("You can't use your own code.");

	const existing = await prisma.affiliateReferrals.findUnique({ where: { memberId } });
	if (existing?.affiliateId === affiliate.discordId) throw new AffiliateError(`You're already using \`${code}\`.`);

	await prisma.affiliateReferrals.upsert({
		where: { memberId },
		create: { memberId, affiliateId: affiliate.discordId, usedAt: BigInt(now) },
		update: { affiliateId: affiliate.discordId, usedAt: BigInt(now) },
	});
	return { affiliate, previous: existing ? await getAffiliate(prisma, existing.affiliateId) : null };
}

/** Stops supporting whoever the member was using. Returns who it was, or null if they weren't using a code. */
export async function clearUsedCode(prisma: PrismaClient, memberId: string): Promise<AffiliateRecord | null> {
	const used = await getUsedCode(prisma, memberId);
	await prisma.affiliateReferrals.deleteMany({ where: { memberId } });
	return used?.affiliate ?? null;
}

// ── withdrawals ──────────────────────────────────────────────────────────────────────────────────

/**
 * Requests a payout. The amount leaves the balance immediately (so it can't be spent twice) and is
 * refunded if staff reject the request. One pending request at a time.
 */
export async function requestWithdrawal(
	prisma: PrismaClient,
	affiliateId: string,
	amountCents: number | null,
	payoutDetails: string,
	minCents: number,
	now = Date.now()
): Promise<WithdrawalRecord> {
	return prisma.$transaction(async (tx) => {
		const affiliate = await tx.affiliates.findUnique({ where: { discordId: affiliateId } });
		if (!affiliate) throw new AffiliateError("You're not an affiliate.");
		if ((await tx.affiliateWithdrawals.count({ where: { affiliateId, status: "pending" } })) > 0)
			throw new AffiliateError("You already have a withdrawal waiting for approval — hang tight!");

		const amount = amountCents ?? affiliate.balanceCents;
		if (amount <= 0) throw new AffiliateError("You don't have any balance to withdraw yet.");
		if (amount < minCents) throw new AffiliateError(`The minimum withdrawal is ${formatMoney(minCents)}.`);
		if (amount > affiliate.balanceCents) throw new AffiliateError(`You only have ${formatMoney(affiliate.balanceCents)} available.`);

		const claimed = await tx.affiliates.updateMany({ where: { discordId: affiliateId, balanceCents: { gte: amount } }, data: { balanceCents: { decrement: amount } } });
		if (claimed.count === 0) throw new AffiliateError("Your balance changed while this was processing — please try again.");

		const withdrawal = await tx.affiliateWithdrawals.create({ data: { affiliateId, amountCents: amount, payoutDetails, requestedAt: BigInt(now) } });
		await tx.affiliateLedger.create({
			data: { affiliateId, type: "withdrawal", amountCents: -amount, balanceAfter: affiliate.balanceCents - amount, note: `Withdrawal #${withdrawal.id} requested`, actor: affiliateId, createdAt: BigInt(now) },
		});
		return toWithdrawal(withdrawal);
	});
}

/** Marks a pending withdrawal as paid, or rejects it and gives the money back. Can only happen once per request. */
export async function resolveWithdrawal(
	prisma: PrismaClient,
	id: number,
	outcome: "paid" | "rejected",
	actor: string,
	note?: string | null,
	now = Date.now()
): Promise<WithdrawalRecord> {
	return prisma.$transaction(async (tx) => {
		const row = await tx.affiliateWithdrawals.findUnique({ where: { id } });
		if (!row) throw new AffiliateError(`Withdrawal #${id} doesn't exist.`);
		if (row.status !== "pending") throw new AffiliateError(`Withdrawal #${id} was already ${row.status}.`);

		const claimed = await tx.affiliateWithdrawals.updateMany({
			where: { id, status: "pending" },
			data: { status: outcome, resolvedAt: BigInt(now), resolvedBy: actor, note: note?.trim() || null },
		});
		if (claimed.count === 0) throw new AffiliateError(`Withdrawal #${id} was already handled.`);

		if (outcome === "paid") {
			await tx.affiliates.updateMany({ where: { discordId: row.affiliateId }, data: { withdrawnCents: { increment: row.amountCents } } });
		} else {
			await tx.affiliates.updateMany({ where: { discordId: row.affiliateId }, data: { balanceCents: { increment: row.amountCents } } });
			const current = await tx.affiliates.findUnique({ where: { discordId: row.affiliateId } });
			if (current) {
				await tx.affiliateLedger.create({
					data: { affiliateId: row.affiliateId, type: "refund", amountCents: row.amountCents, balanceAfter: current.balanceCents, note: `Withdrawal #${id} rejected`, actor, createdAt: BigInt(now) },
				});
			}
		}
		return toWithdrawal(await tx.affiliateWithdrawals.findUniqueOrThrow({ where: { id } }));
	});
}

export async function getWithdrawal(prisma: PrismaClient, id: number): Promise<WithdrawalRecord | null> {
	const row = await prisma.affiliateWithdrawals.findUnique({ where: { id } });
	return row ? toWithdrawal(row) : null;
}

export async function listWithdrawals(prisma: PrismaClient, filter: { affiliateId?: string; status?: WithdrawalStatus; limit?: number } = {}): Promise<WithdrawalRecord[]> {
	const rows = await prisma.affiliateWithdrawals.findMany({
		where: { ...(filter.affiliateId ? { affiliateId: filter.affiliateId } : {}), ...(filter.status ? { status: filter.status } : {}) },
		orderBy: { id: "desc" },
		take: filter.limit ?? 10,
	});
	return rows.map(toWithdrawal);
}

export async function setPayoutMessage(prisma: PrismaClient, id: number, channelId: string, messageId: string): Promise<void> {
	await prisma.affiliateWithdrawals.update({ where: { id }, data: { payoutChannelId: channelId, payoutMessageId: messageId } });
}

export async function listLedger(prisma: PrismaClient, affiliateId: string, limit = 8): Promise<LedgerRecord[]> {
	const rows = await prisma.affiliateLedger.findMany({ where: { affiliateId }, orderBy: { id: "desc" }, take: limit });
	return rows.map((r) => ({ ...r, createdAt: Number(r.createdAt) }));
}

// ── CSV export (so the data is readable outside Discord) ─────────────────────────────────────────

/** Strings are user-influenced, so a leading =, +, -, @ is defused to stop spreadsheet formula injection. */
function cell(value: string | number | null): string {
	if (value === null) return "";
	if (typeof value === "number") return String(value);
	const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
	return `"${safe.replace(/"/g, '""')}"`;
}

const csv = (header: string[], rows: (string | number | null)[][]) => [header.join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n") + "\n";
const usd = (cents: number) => (cents / 100).toFixed(2);
const iso = (ms: number | bigint | null) => (ms === null ? null : new Date(Number(ms)).toISOString());

export async function exportCsvFiles(prisma: PrismaClient): Promise<{ name: string; content: string }[]> {
	const [affiliates, referrals, withdrawals, ledger] = await Promise.all([
		listAffiliates(prisma),
		prisma.affiliateReferrals.findMany({ orderBy: { usedAt: "asc" } }),
		prisma.affiliateWithdrawals.findMany({ orderBy: { id: "asc" } }),
		prisma.affiliateLedger.findMany({ orderBy: { id: "asc" } }),
	]);
	const codeById = new Map(affiliates.map((a) => [a.discordId, a.code]));

	return [
		{
			name: "affiliates.csv",
			content: csv(
				["discord_id", "code", "balance_usd", "earned_usd", "withdrawn_usd", "referrals", "created_by", "created_at"],
				affiliates.map((a) => [a.discordId, a.code, usd(a.balanceCents), usd(a.earnedCents), usd(a.withdrawnCents), a.referrals, a.createdBy, iso(a.createdAt)])
			),
		},
		{
			name: "referrals.csv",
			content: csv(
				["member_id", "affiliate_id", "code", "used_at"],
				referrals.map((r) => [r.memberId, r.affiliateId, codeById.get(r.affiliateId) ?? "", iso(r.usedAt)])
			),
		},
		{
			name: "withdrawals.csv",
			content: csv(
				["id", "affiliate_id", "amount_usd", "status", "payout_details", "requested_at", "resolved_at", "resolved_by", "note"],
				withdrawals.map((w) => [w.id, w.affiliateId, usd(w.amountCents), w.status, w.payoutDetails, iso(w.requestedAt), iso(w.resolvedAt), w.resolvedBy, w.note])
			),
		},
		{
			name: "ledger.csv",
			content: csv(
				["id", "affiliate_id", "type", "amount_usd", "balance_after_usd", "note", "actor", "created_at"],
				ledger.map((l) => [l.id, l.affiliateId, l.type, usd(l.amountCents), usd(l.balanceAfter), l.note, l.actor, iso(l.createdAt)])
			),
		},
	];
}
