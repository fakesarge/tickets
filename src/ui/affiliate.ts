import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	MessageFlags,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
	type MessageCreateOptions,
	type User,
} from "discord.js";
import {
	AffiliateRecord,
	AffiliateSummary,
	BalanceAction,
	LedgerRecord,
	ReferralRecord,
	WithdrawalRecord,
	WithdrawalStatus,
	formatMoney,
	signedMoney,
} from "../lib/affiliate";
import { resolveColor } from "../lib/tickets";
import { brand } from "./theme";

/** What the slash commands send (they defer an ephemeral reply, then edit it with these components). */
export type Panel = { components: ContainerBuilder[] };

/** Just enough of a Discord user to draw their avatar next to a card. */
export type Person = { id: string; avatarUrl: string };
export const personOf = (user: User): Person => ({ id: user.id, avatarUrl: user.displayAvatarURL({ extension: "png", size: 256 }) });

export const WITHDRAWAL_BUTTON_PREFIX = "aff_wd__";
export const USE_CODE_BUTTON_PREFIX = "aff_use__";

const GREEN = 0x3ba55c;
const AMBER = 0xfaa61a;
const RED = 0xed4245;
const GREY = 0x80848e;

const accent = () => resolveColor(brand().colors.accent, "#B55CFF");
const text = (body: string) => new TextDisplayBuilder().setContent(body);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const panel = (c: ContainerBuilder): Panel => ({ components: [c] });

const sec = (ms: number) => Math.floor(ms / 1000);
const relative = (ms: number) => `<t:${sec(ms)}:R>`;
const day = (ms: number) => `<t:${sec(ms)}:d>`;
const full = (ms: number) => `<t:${sec(ms)}:f>`;
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Fenced block that user-supplied text can't break out of. */
const codeBlock = (body: string) => "```\n" + body.replace(/`/g, "ʼ") + "\n```";

/** One card: a header (optionally with an avatar beside it), then each extra block under a divider. */
function card(color: number, header: string, more: string[] = [], avatarUrl?: string): ContainerBuilder {
	const c = new ContainerBuilder().setAccentColor(color);
	if (avatarUrl) {
		c.addSectionComponents((s: SectionBuilder) => s.addTextDisplayComponents(text(header)).setThumbnailAccessory((t) => t.setURL(avatarUrl)));
	} else {
		c.addTextDisplayComponents(text(header));
	}
	for (const block of more) {
		if (!block) continue;
		c.addSeparatorComponents(divider());
		c.addTextDisplayComponents(text(block));
	}
	return c;
}

/** "Use this code" button on the public cards — anyone can tap it to start supporting that creator. */
const useCodeRow = (code: string) =>
	new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId(`${USE_CODE_BUTTON_PREFIX}${code}`).setLabel(`Use code ${code}`).setEmoji("🎟️").setStyle(ButtonStyle.Secondary)
	);

const STATUS: Record<WithdrawalStatus, { emoji: string; label: string; color: number }> = {
	pending: { emoji: "🕒", label: "Pending", color: AMBER },
	paid: { emoji: "✅", label: "Paid", color: GREEN },
	rejected: { emoji: "❌", label: "Rejected", color: RED },
};

const LEDGER_LABEL: Record<string, string> = {
	credit: "Earnings added",
	debit: "Deducted",
	adjustment: "Balance set",
	withdrawal: "Withdrawal",
	refund: "Refund",
};

const ledgerLine = (l: LedgerRecord) =>
	`\`${signedMoney(l.amountCents)}\` ${LEDGER_LABEL[l.type] ?? l.type} · ${relative(l.createdAt)}${l.note ? ` · ${clip(l.note.replace(/\s+/g, " "), 50)}` : ""}`;

const withdrawalLine = (w: WithdrawalRecord) => `**#${w.id}** · ${formatMoney(w.amountCents)} · ${STATUS[w.status].emoji} ${STATUS[w.status].label} · ${relative(w.requestedAt)}`;

function progress(balance: number, min: number): string {
	if (balance >= min) return "✅ You can withdraw now — use `/affiliate withdraw`.";
	const filled = min > 0 ? Math.min(10, Math.floor((balance / min) * 10)) : 10;
	return `${"▰".repeat(filled)}${"▱".repeat(10 - filled)}\n-# ${formatMoney(balance)} of ${formatMoney(min)} needed to unlock withdrawals`;
}

function statLines(a: AffiliateRecord, referrals: number): string {
	return [
		`👥 **Referrals** — ${referrals}`,
		`💰 **Balance** — ${formatMoney(a.balanceCents)}`,
		`📈 **Lifetime earned** — ${formatMoney(a.earnedCents)}`,
		`💸 **Withdrawn** — ${formatMoney(a.withdrawnCents)}`,
	].join("\n");
}

// ── affiliate-facing ─────────────────────────────────────────────────────────────────────────────

export type DashboardExtras = {
	referrals: number;
	minCents: number;
	pending: WithdrawalRecord | null;
	/** Only on the detailed /affiliate stats view. */
	rank?: number;
	affiliateCount?: number;
	recent?: LedgerRecord[];
	/** Add the "Use code" button so anyone can tap to support them. Off for private views. */
	button?: boolean;
};

/** /affiliate me (compact) and /affiliate stats (with rank + recent activity). Public by default so affiliates can show off. */
export function buildDashboardPayload(p: Person, a: AffiliateRecord, x: DashboardExtras): Panel {
	const header = `## 🎟️ <@${a.discordId}>'s affiliate stats\n**Creator code**\n${codeBlock(a.code)}\n-# Support them with \`/code use\` or the button below`;
	const status = x.pending ? `🕒 Withdrawal **#${x.pending.id}** for **${formatMoney(x.pending.amountCents)}** is waiting for approval.` : progress(a.balanceCents, x.minCents);

	const blocks = [statLines(a, x.referrals) + (x.rank && x.affiliateCount ? `\n🏆 **Rank** — #${x.rank} of ${x.affiliateCount}` : ""), status];
	if (x.recent) blocks.push(x.recent.length > 0 ? `**Recent activity**\n${x.recent.map(ledgerLine).join("\n")}` : "**Recent activity**\nNothing yet — earnings show up here.");
	blocks.push(`-# Affiliate since ${day(a.createdAt)}`);
	const c = card(accent(), header, blocks, p.avatarUrl);
	if (x.button !== false) c.addActionRowComponents(useCodeRow(a.code));
	return panel(c);
}

export function buildHistoryPayload(affiliateId: string, ledger: LedgerRecord[], withdrawals: WithdrawalRecord[]): Panel {
	const activity = ledger.length > 0 ? ledger.map(ledgerLine).join("\n") : "No activity yet.";
	const payouts = withdrawals.length > 0 ? withdrawals.map(withdrawalLine).join("\n") : "No withdrawals yet.";
	return panel(card(accent(), `## 📜 <@${affiliateId}>'s history`, [`**Balance activity**\n${activity}`, `**Withdrawals**\n${payouts}`]));
}

/** Public. Deliberately leaves out the payout details (an email / bank info) — staff see those in the payout channel. */
export function buildWithdrawalRequestedPayload(w: WithdrawalRecord, notified: boolean): Panel {
	const header = `## 💸 Withdrawal requested\n<@${w.affiliateId}> just requested a payout of **${formatMoney(w.amountCents)}**.`;
	const foot = `-# Request #${w.id} · ${notified ? "Staff have been notified." : "Staff will pick it up shortly."} They'll get a DM when it's handled.`;
	return panel(card(AMBER, header, [foot]));
}

// ── members using a code ─────────────────────────────────────────────────────────────────────────

export function buildCodeUsedPayload(creator: Person | null, a: AffiliateRecord, previous: AffiliateRecord | null): Panel {
	const switched = previous ? `\n-# Switched from \`${previous.code}\`.` : "";
	const header = `## 🎟️ You're supporting <@${a.discordId}>\nCode \`${a.code}\` is now active.${switched}`;
	return panel(card(GREEN, header, ["Thanks for the support! You can change or remove it any time with `/code use` and `/code clear`."], creator?.avatarUrl));
}

/** Public when the member is using a code (it promotes the creator); private when they aren't. */
export function buildCodeViewPayload(memberId: string, creator: Person | null, used: { affiliate: AffiliateRecord; usedAt: number } | null): Panel {
	if (!used) return panel(card(GREY, "## 🎟️ Creator code\nYou're not using a code right now.", ["Got a code from a creator? Enter it with `/code use`."]));
	const header = `## 🎟️ <@${memberId}> is supporting <@${used.affiliate.discordId}>\n**Creator code**\n${codeBlock(used.affiliate.code)}`;
	const c = card(accent(), header, [`-# Supporting since ${day(used.usedAt)} · support them too with the button below or \`/code use\``], creator?.avatarUrl);
	c.addActionRowComponents(useCodeRow(used.affiliate.code));
	return panel(c);
}

/** Public announcement when someone starts using a code. */
export function buildSupportAnnouncementPayload(memberId: string, creator: Person | null, a: AffiliateRecord, previous: AffiliateRecord | null): Panel {
	const switched = previous ? `\n-# Switched from \`${previous.code}\`.` : "";
	const header = `## 🎟️ <@${memberId}> is supporting <@${a.discordId}>\nThey're using creator code \`${a.code}\`.${switched}`;
	const c = card(GREEN, header, ["Want to support them too? Tap the button, or use `/code use`."], creator?.avatarUrl);
	c.addActionRowComponents(useCodeRow(a.code));
	return panel(c);
}

/** Public showcase an affiliate posts with /affiliate share. Shows the code and supporter count — never money. */
export function buildSharePayload(p: Person, a: AffiliateRecord, referrals: number): Panel {
	const header = `## 🎟️ Support <@${a.discordId}>\nUse their creator code to back them every time you shop.\n**Creator code**\n${codeBlock(a.code)}`;
	const supporters = `👥 **${referrals}** ${referrals === 1 ? "supporter" : "supporters"}\n-# Tap the button below or run \`/code use\`.`;
	const c = card(accent(), header, [supporters], p.avatarUrl);
	c.addActionRowComponents(useCodeRow(a.code));
	return panel(c);
}

export function buildCodeClearedPayload(previous: AffiliateRecord | null): Panel {
	if (!previous) return panel(card(GREY, "## 🎟️ Creator code\nYou weren't using a code."));
	return panel(card(GREY, `## 🎟️ Code removed\nYou're no longer supporting <@${previous.discordId}> (\`${previous.code}\`).`));
}

// ── admin-facing ─────────────────────────────────────────────────────────────────────────────────

export function buildAffiliateCreatedPayload(p: Person | null, a: AffiliateRecord, roleNote: string): Panel {
	const header = `## 🎟️ Affiliate created\n<@${a.discordId}> is now an affiliate.\n**Code**\n${codeBlock(a.code)}`;
	return panel(card(GREEN, header, [`-# ${roleNote}`], p?.avatarUrl));
}

export function buildAffiliateRemovedPayload(a: AffiliateRecord, roleNote: string): Panel {
	const forfeited = a.balanceCents > 0 ? `\nTheir remaining balance of **${formatMoney(a.balanceCents)}** was cleared with the record.` : "";
	return panel(card(RED, `## 🎟️ Affiliate removed\n<@${a.discordId}> (\`${a.code}\`) is no longer an affiliate, and anyone using their code has been detached.${forfeited}`, [`-# ${roleNote}`]));
}

export function buildCodeChangedPayload(a: AffiliateRecord, oldCode: string): Panel {
	return panel(card(GREEN, `## 🎟️ Code changed\n<@${a.discordId}>'s code is now \`${a.code}\` (was \`${oldCode}\`).`, ["-# Members already using the old code keep supporting them."]));
}

export function buildBalanceChangedPayload(a: AffiliateRecord, action: BalanceAction, delta: number, note?: string | null): Panel {
	const verb = action === "add" ? "Earnings added" : action === "remove" ? "Deducted" : "Balance set";
	const header = delta === 0 ? `## 💰 No change\n<@${a.discordId}>'s balance is already ${formatMoney(a.balanceCents)}.` : `## 💰 ${verb}\n<@${a.discordId}> · \`${signedMoney(delta)}\``;
	const blocks = [`💰 **Balance** — ${formatMoney(a.balanceCents)}\n📈 **Lifetime earned** — ${formatMoney(a.earnedCents)}`, note ? `**Note**\n${clip(note, 300)}` : ""];
	return panel(card(delta < 0 ? RED : delta > 0 ? GREEN : GREY, header, blocks));
}

export type AdminViewData = {
	referrals: number;
	recentReferrals: ReferralRecord[];
	ledger: LedgerRecord[];
	withdrawals: WithdrawalRecord[];
	rank: number;
};

export function buildAdminViewPayload(p: Person | null, a: AffiliateRecord, x: AdminViewData): Panel {
	const header = `## 🎟️ Affiliate — <@${a.discordId}>\n**Code**\n${codeBlock(a.code)}`;
	const refs =
		x.recentReferrals.length > 0
			? `**Latest referrals** (${x.recentReferrals.length} of ${x.referrals})\n${x.recentReferrals.map((r) => `<@${r.memberId}> · ${day(r.usedAt)}`).join("\n")}`
			: "**Referrals**\nNobody is using this code yet.";
	const ledger = x.ledger.length > 0 ? `**Recent activity**\n${x.ledger.map(ledgerLine).join("\n")}` : "";
	const withdrawals = x.withdrawals.length > 0 ? `**Withdrawals**\n${x.withdrawals.map(withdrawalLine).join("\n")}` : "";
	const foot = `-# Created by <@${a.createdBy}> on ${day(a.createdAt)}`;
	return panel(card(accent(), header, [statLines(a, x.referrals) + `\n🏆 **Rank** — #${x.rank}`, refs, ledger, withdrawals, foot], p?.avatarUrl));
}

const MEDALS = ["🥇", "🥈", "🥉"];

export function buildAffiliateListPayload(rows: AffiliateSummary[]): Panel {
	if (rows.length === 0) return panel(card(GREY, "## 🎟️ Affiliates\nNo affiliates yet. Create one with `/affiliate admin create`."));
	const shown = rows.slice(0, 15);
	const lines = shown.map(
		(r, i) => `${MEDALS[i] ?? `**${i + 1}.**`} <@${r.discordId}> · \`${r.code}\`\n-# ${r.referrals} referrals · earned ${formatMoney(r.earnedCents)} · balance ${formatMoney(r.balanceCents)}`
	);
	const totals = rows.reduce((t, r) => ({ referrals: t.referrals + r.referrals, balance: t.balance + r.balanceCents, earned: t.earned + r.earnedCents }), { referrals: 0, balance: 0, earned: 0 });
	const more = rows.length > shown.length ? `\n\n-# Showing the top ${shown.length} of ${rows.length} by lifetime earnings.` : "";
	const summary = `-# ${rows.length} affiliates · ${totals.referrals} referrals · ${formatMoney(totals.earned)} earned · ${formatMoney(totals.balance)} owed in balances`;
	return panel(card(accent(), `## 🎟️ Affiliates (${rows.length})`, [lines.join("\n") + more, summary]));
}

export function buildPayoutListPayload(pending: WithdrawalRecord[]): Panel {
	if (pending.length === 0) return panel(card(GREEN, "## 💸 Pending withdrawals\nNothing waiting — all caught up."));
	const lines = pending.map((w) => `**#${w.id}** · <@${w.affiliateId}> · **${formatMoney(w.amountCents)}** · ${relative(w.requestedAt)}\n-# ${clip(w.payoutDetails.replace(/\s+/g, " "), 80)}`);
	return panel(card(AMBER, `## 💸 Pending withdrawals (${pending.length})`, [lines.join("\n"), "-# Use `/affiliate admin approve` or `reject` — or the buttons in the payout channel."]));
}

// ── withdrawal card (payout channel) ─────────────────────────────────────────────────────────────

export type ChannelCard = { flags: MessageFlags.IsComponentsV2; components: ContainerBuilder[]; allowedMentions: { parse: [] } };

/** The staff-facing request. Pending ones carry Approve / Reject buttons; resolved ones are the same card without them. */
export function buildWithdrawalCard(w: WithdrawalRecord, code: string | undefined): ChannelCard {
	const s = STATUS[w.status];
	const header = `## 💸 Withdrawal request #${w.id}\n**Affiliate:** <@${w.affiliateId}>${code ? ` · \`${code}\`` : ""}\n**Amount:** ${formatMoney(w.amountCents)}`;
	const details = `**Payout details**\n${codeBlock(w.payoutDetails)}`;

	const resolved =
		w.status === "pending"
			? `${s.emoji} **Pending** — requested ${full(w.requestedAt)}`
			: `${s.emoji} **${s.label}** by <@${w.resolvedBy}> ${w.resolvedAt ? relative(w.resolvedAt) : ""}${w.note ? `\n**Note:** ${clip(w.note, 300)}` : ""}`;

	const c = card(s.color, header, [details, resolved]);
	if (w.status === "pending") {
		c.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId(`${WITHDRAWAL_BUTTON_PREFIX}approve__${w.id}`).setLabel("Mark as paid").setEmoji("✅").setStyle(ButtonStyle.Success),
				new ButtonBuilder().setCustomId(`${WITHDRAWAL_BUTTON_PREFIX}reject__${w.id}`).setLabel("Reject & refund").setEmoji("✖️").setStyle(ButtonStyle.Danger)
			)
		);
	}
	return { flags: MessageFlags.IsComponentsV2, components: [c], allowedMentions: { parse: [] } };
}

// ── DMs ──────────────────────────────────────────────────────────────────────────────────────────

const dm = (c: ContainerBuilder): MessageCreateOptions => ({ flags: MessageFlags.IsComponentsV2, components: [c] });

export function buildReferralDm(memberId: string, a: AffiliateRecord, referrals: number): MessageCreateOptions {
	return dm(card(GREEN, `## 🎟️ New supporter!\n<@${memberId}> just started using your code \`${a.code}\`.`, [`👥 You now have **${referrals}** ${referrals === 1 ? "referral" : "referrals"}.\n-# See everything with \`/affiliate stats\`.`]));
}

export function buildBalanceDm(a: AffiliateRecord, action: BalanceAction, delta: number, note?: string | null): MessageCreateOptions {
	const title = action === "add" ? "💰 You earned money!" : action === "remove" ? "💰 Balance adjusted" : "💰 Balance updated";
	const change = delta === 0 ? "" : `\n\`${signedMoney(delta)}\``;
	return dm(
		card(delta < 0 ? RED : GREEN, `## ${title}${change}`, [`**New balance:** ${formatMoney(a.balanceCents)}${note ? `\n**Note:** ${clip(note, 300)}` : ""}`, "-# Withdraw any time with `/affiliate withdraw`."])
	);
}

export function buildWithdrawalDm(w: WithdrawalRecord): MessageCreateOptions {
	const s = STATUS[w.status];
	const body =
		w.status === "paid"
			? `Your withdrawal of **${formatMoney(w.amountCents)}** has been paid out. 🎉`
			: `Your withdrawal of **${formatMoney(w.amountCents)}** was rejected, and the amount is back in your balance.`;
	const note = w.note ? `**Note from staff**\n${clip(w.note, 300)}` : "";
	return dm(card(s.color, `## ${s.emoji} Withdrawal #${w.id} ${s.label.toLowerCase()}\n${body}`, [note, "-# Check your numbers any time with `/affiliate stats`."]));
}
