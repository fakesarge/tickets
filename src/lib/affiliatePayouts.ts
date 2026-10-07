import { ButtonInteraction, GuildMember, MessageCreateOptions, MessageFlags } from "discord.js";
import type ExtendedClient from "../structure/ExtendedClient";
import { AffiliateError, WithdrawalRecord, affiliateSettings, getAffiliate, getWithdrawal, resolveWithdrawal, setPayoutMessage } from "./affiliate";
import { isAdmin } from "./permissions";
import { WITHDRAWAL_BUTTON_PREFIX, buildWithdrawalCard, buildWithdrawalDm } from "../ui/affiliate";
import { MSG } from "../ui/messages";

/** Sends a DM without ever throwing — a closed DM must never break an admin action or a command. */
export async function dmUser(client: ExtendedClient, userId: string, payload: MessageCreateOptions): Promise<boolean> {
	try {
		const user = await client.users.fetch(userId);
		await user.send(payload);
		return true;
	} catch (err) {
		console.warn(`Affiliate DM: couldn't message ${userId}.`, err instanceof Error ? err.message : err);
		return false;
	}
}

async function messageFor(client: ExtendedClient, w: WithdrawalRecord) {
	if (!w.payoutChannelId || !w.payoutMessageId) return null;
	const channel = await client.channels.fetch(w.payoutChannelId).catch(() => null);
	if (!channel || !channel.isTextBased() || channel.isDMBased()) return null;
	return channel.messages.fetch(w.payoutMessageId).catch(() => null);
}

/** Posts a new request to the payout channel (if one is configured). Returns whether staff were notified there. */
export async function postPayoutRequest(client: ExtendedClient, w: WithdrawalRecord): Promise<boolean> {
	const { payoutChannelId } = affiliateSettings(client);
	if (!payoutChannelId) return false;
	try {
		const channel = await client.channels.fetch(payoutChannelId);
		if (!channel || !channel.isTextBased() || channel.isDMBased()) return false;
		const code = (await getAffiliate(client.prisma, w.affiliateId))?.code;
		const sent = await channel.send(buildWithdrawalCard(w, code));
		await setPayoutMessage(client.prisma, w.id, channel.id, sent.id);
		return true;
	} catch (err) {
		console.error("Affiliate payouts: couldn't post the withdrawal request:", err);
		return false;
	}
}

/**
 * Marks a withdrawal paid or rejected, rewrites the staff card without its buttons, and DMs the affiliate.
 * Throws AffiliateError if it was already handled.
 */
export async function settleWithdrawal(
	client: ExtendedClient,
	id: number,
	outcome: "paid" | "rejected",
	actorId: string,
	note?: string | null
): Promise<{ withdrawal: WithdrawalRecord; dmSent: boolean }> {
	const withdrawal = await resolveWithdrawal(client.prisma, id, outcome, actorId, note);

	const message = await messageFor(client, withdrawal);
	if (message) {
		const code = (await getAffiliate(client.prisma, withdrawal.affiliateId))?.code;
		await message.edit(buildWithdrawalCard(withdrawal, code)).catch((err) => console.error("Affiliate payouts: couldn't update the request card:", err));
	}

	const dmSent = await dmUser(client, withdrawal.affiliateId, buildWithdrawalDm(withdrawal));
	return { withdrawal, dmSent };
}

/** Approve / Reject buttons on a request card in the payout channel. Admins only. */
export async function handleWithdrawalButton(interaction: ButtonInteraction, client: ExtendedClient): Promise<void> {
	if (!isAdmin(client, interaction.member as GuildMember | null)) {
		await interaction.reply({ content: MSG.adminOnly, flags: MessageFlags.Ephemeral }).catch(() => null);
		return;
	}

	const [action, rawId] = interaction.customId.slice(WITHDRAWAL_BUTTON_PREFIX.length).split("__");
	const id = Number(rawId);
	if ((action !== "approve" && action !== "reject") || !Number.isInteger(id)) return;

	await interaction.deferUpdate().catch(() => null);
	try {
		await settleWithdrawal(client, id, action === "approve" ? "paid" : "rejected", interaction.user.id);
	} catch (err) {
		if (!(err instanceof AffiliateError)) console.error("Affiliate payouts: button failed:", err);
		await interaction.followUp({ content: err instanceof AffiliateError ? err.message : "Something went wrong — check the bot logs.", flags: MessageFlags.Ephemeral }).catch(() => null);

		// A stale card (already handled elsewhere) should stop offering buttons.
		const current = await getWithdrawal(client.prisma, id);
		if (current && current.status !== "pending") {
			const code = (await getAffiliate(client.prisma, current.affiliateId))?.code;
			await interaction.message.edit(buildWithdrawalCard(current, code)).catch(() => null);
		}
	}
}
