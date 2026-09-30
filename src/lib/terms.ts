import { ButtonInteraction, ChannelType, ModalSubmitInteraction } from "discord.js";
import ExtendedClient from "../structure/ExtendedClient";
import { getTicketType } from "./tickets";
import { buildTermsModal, readTermsModal } from "./modals";
import { buildTermsPromptPayload, buildTermsSignedPayload } from "../ui/terms";
import { MSG } from "../ui/messages";
import { logEvent } from "./logs";

/** "Continue" button on the welcome panel: reveals the terms prompt in the same message. */
export async function handleShowTerms(interaction: ButtonInteraction, client: ExtendedClient): Promise<void> {
	if (interaction.channel?.type !== ChannelType.GuildText) return;

	const ticket = await client.prisma.tickets.findUnique({ where: { channelId: interaction.channel.id } });
	if (!ticket || ticket.creator !== interaction.user.id) {
		await interaction.reply({ content: MSG.termsOwnerOnlyAccept, ephemeral: true }).catch(() => null);
		return;
	}

	await interaction.update(buildTermsPromptPayload()).catch((e) => console.error(e));
}

/** "Agree To Terms" button: opens the signature (+ ticket questions) modal. */
export async function handleTosAgree(interaction: ButtonInteraction, client: ExtendedClient): Promise<void> {
	if (interaction.channel?.type !== ChannelType.GuildText) return;

	const ticket = await client.prisma.tickets.findUnique({ where: { channelId: interaction.channel.id } });
	if (!ticket || ticket.creator !== interaction.user.id) {
		await interaction.reply({ content: MSG.termsOwnerOnlyAccept, ephemeral: true }).catch(() => null);
		return;
	}
	if (!ticket.termsMessageId) {
		await interaction.reply({ content: MSG.termsNotLinked, ephemeral: true }).catch(() => null);
		return;
	}

	const ticketType = getTicketType(client, ticket.typeCodeName);
	if (!ticketType) {
		await interaction.reply({ content: MSG.termsInvalidConfig, ephemeral: true }).catch(() => null);
		return;
	}

	await interaction.showModal(buildTermsModal(ticketType)).catch((e) => console.error(e));
}

/** "Decline Agreement" button: removes the ticket. */
export async function handleTosDecline(interaction: ButtonInteraction, client: ExtendedClient): Promise<void> {
	if (interaction.channel?.type !== ChannelType.GuildText) return;
	const channel = interaction.channel;

	const ticket = await client.prisma.tickets.findUnique({ where: { channelId: channel.id } });
	if (!ticket || ticket.creator !== interaction.user.id) {
		await interaction.reply({ content: MSG.termsOwnerOnlyDecline, ephemeral: true }).catch(() => null);
		return;
	}

	await interaction.deferReply({ ephemeral: true }).catch(() => null);
	await client.prisma.tickets.delete({ where: { channelId: channel.id } }).catch(() => null);
	await interaction.editReply({ content: MSG.termsDeclined }).catch(() => null);
	await channel.delete().catch((e) => console.error(e));
}

/**
 * Terms modal submit: edits the same message into its signed state and logs "ticketCreate"
 * with the collected answers. There's no separate ticket-details message to update — the
 * welcome panel this all started on is the only message that changes.
 */
export async function handleTosIntake(interaction: ModalSubmitInteraction, client: ExtendedClient): Promise<void> {
	if (interaction.channel?.type !== ChannelType.GuildText) return;
	const channel = interaction.channel;

	const codeName = interaction.customId.replace("tosIntake__", "");
	const ticketType = getTicketType(client, codeName);
	if (!ticketType) return void interaction.reply({ content: MSG.typeUnavailable, ephemeral: true }).catch(() => null);

	await interaction.deferReply({ ephemeral: true }).catch(() => null);

	const ticket = await client.prisma.tickets.findUnique({ where: { channelId: channel.id } });
	if (!ticket || ticket.creator !== interaction.user.id) {
		await interaction.editReply({ content: MSG.termsNotOwner });
		return;
	}
	if (!ticket.termsMessageId) {
		await interaction.editReply({ content: MSG.termsNoStep });
		return;
	}

	const { signature, reasonText } = readTermsModal(interaction, ticketType);
	await client.prisma.tickets.update({ where: { channelId: channel.id }, data: { reason: reasonText } });

	const termsMessage = await channel.messages.fetch(ticket.termsMessageId).catch(() => null);
	await termsMessage?.edit(buildTermsSignedPayload(signature)).catch((e) => console.error(e));

	await logEvent(client, { type: "ticketCreate", user: interaction.user, channelId: channel.id, reason: reasonText });

	await interaction.editReply({ content: MSG.termsAccepted }).catch(() => null);
}
