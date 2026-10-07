import { ButtonInteraction, MessageFlags } from "discord.js";
import type ExtendedClient from "../structure/ExtendedClient";
import { AffiliateError, AffiliateRecord, referralCount, useCode } from "./affiliate";
import { dmUser } from "./affiliatePayouts";
import { Person, USE_CODE_BUTTON_PREFIX, buildCodeUsedPayload, buildReferralDm, personOf } from "../ui/affiliate";
import { MSG } from "../ui/messages";

/** Starts a member supporting a code, then DMs the creator. Throws AffiliateError for anything the member should read. */
export async function applyCode(
	client: ExtendedClient,
	memberId: string,
	rawCode: string
): Promise<{ affiliate: AffiliateRecord; previous: AffiliateRecord | null; creator: Person | null }> {
	const { affiliate, previous } = await useCode(client.prisma, memberId, rawCode);
	const creator = await client.users.fetch(affiliate.discordId).catch(() => null);
	void referralCount(client.prisma, affiliate.discordId).then((count) => dmUser(client, affiliate.discordId, buildReferralDm(memberId, affiliate, count)));
	return { affiliate, previous, creator: creator ? personOf(creator) : null };
}

/** The "Use code …" button on public cards. The confirmation is private to whoever tapped it. */
export async function handleUseCodeButton(interaction: ButtonInteraction, client: ExtendedClient): Promise<void> {
	await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
	try {
		const { affiliate, previous, creator } = await applyCode(client, interaction.user.id, interaction.customId.slice(USE_CODE_BUTTON_PREFIX.length));
		await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: buildCodeUsedPayload(creator, affiliate, previous).components as never });
	} catch (err) {
		if (!(err instanceof AffiliateError)) console.error("Affiliate: use-code button failed:", err);
		await interaction.editReply({ content: err instanceof AffiliateError ? err.message : MSG.commandError }).catch(() => null);
	}
}
