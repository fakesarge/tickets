import { AutocompleteInteraction, ButtonInteraction, ChannelType, ChatInputCommandInteraction, GuildMember, Interaction, StringSelectMenuInteraction, TextChannel } from "discord.js";
import BaseEvent from "../structure/BaseEvent";
import { getTicketType, isBlacklisted, isBlockedFromTicketType, isStaffFor } from "../lib/tickets";
import { claimTicket, createTicket, deleteTicketChannel } from "../lib/ticketActions";
import { logEvent } from "../lib/logs";
import { FLOW_CUSTOM_IDS } from "../lib/flows/render";
import { handleFlowButton, handleFlowModalSubmit, handleFlowSelect } from "../lib/flows/engine";
import { handleShowTerms, handleTosAgree, handleTosDecline, handleTosIntake } from "../lib/terms";
import { MSG } from "../ui/messages";

type OpenInteraction = ButtonInteraction | StringSelectMenuInteraction;

export default class InteractionCreateEvent extends BaseEvent {
	public async execute(interaction: Interaction): Promise<void> {
		if (interaction.isChatInputCommand()) return this.handleCommand(interaction);
		if (interaction.isAutocomplete()) return this.handleAutocomplete(interaction);

		if (interaction.isStringSelectMenu()) {
			if (interaction.customId === "ticket_open_select") return this.openTicket(interaction, interaction.values[0]);
			if (interaction.customId === "ticket_remove_select") return this.handleRemoveSelect(interaction);
			if (interaction.customId === FLOW_CUSTOM_IDS.select) return handleFlowSelect(interaction, this.client);
			return;
		}

		if (interaction.isButton()) {
			if (interaction.customId.startsWith("openTicket_")) return this.openTicket(interaction, interaction.customId.replace(/^openTicket_/, ""));
			if (interaction.customId === "ticketShowTerms") return handleShowTerms(interaction, this.client);
			if (interaction.customId === "tosAgree") return handleTosAgree(interaction, this.client);
			if (interaction.customId === "tosDecline") return handleTosDecline(interaction, this.client);
			if (this.isFlowButton(interaction.customId)) return handleFlowButton(interaction, this.client);
			return this.handleButton(interaction);
		}

		if (interaction.isModalSubmit()) {
			if (interaction.customId.startsWith("tosIntake__")) return handleTosIntake(interaction, this.client);
			if (interaction.customId.startsWith("flow_modalsubmit__")) return handleFlowModalSubmit(interaction, this.client);
			return;
		}
	}

	private isFlowButton(customId: string): boolean {
		return (
			customId === FLOW_CUSTOM_IDS.back ||
			customId === FLOW_CUSTOM_IDS.restart ||
			customId === FLOW_CUSTOM_IDS.staff ||
			customId.startsWith("flow_btn__") ||
			customId.startsWith("flow_modalopen__")
		);
	}

	private async handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
		const command = this.client.commands.get(interaction.commandName);
		if (!command?.autocomplete) return void interaction.respond([]).catch(() => null);
		try {
			await command.autocomplete(interaction);
		} catch (err) {
			console.error(`Error in /${interaction.commandName} autocomplete:`, err);
			if (!interaction.responded) await interaction.respond([]).catch(() => null);
		}
	}

	private async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
		const command = this.client.commands.get(interaction.commandName);
		if (!command) return;
		try {
			await command.execute(interaction);
		} catch (err) {
			console.error(`Error running /${interaction.commandName}:`, err);
			const payload = { content: MSG.commandError, ephemeral: true };
			if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
			else await interaction.reply(payload).catch(() => null);
		}
	}

	/**
	 * Shared entry point for the panel's buttons and its select-menu fallback. Always creates the
	 * ticket directly — the welcome panel it sends is what collects everything else (terms,
	 * signature, and this type's questions) via "Continue" → "Agree To Terms".
	 */
	private async openTicket(interaction: OpenInteraction, codeName: string): Promise<void> {
		const ticketType = getTicketType(this.client, codeName);
		if (!ticketType) return void interaction.reply({ content: MSG.typeUnavailable, ephemeral: true }).catch(() => null);

		const member = interaction.member as GuildMember | null;
		if (isBlacklisted(this.client, member)) return void interaction.reply({ content: MSG.blacklisted, ephemeral: true }).catch(() => null);
		if (isBlockedFromTicketType(member, ticketType))
			return void interaction.reply({ content: MSG.typeBlockedForRoles, ephemeral: true }).catch(() => null);

		// The terms modal holds the signature plus at most four of the type's questions (billing
		// has its own fixed 3-field shape instead, so it's exempt from this check).
		if (ticketType.codeName !== "billing" && ticketType.questions.length > 4)
			return void interaction.reply({ content: MSG.invalidConfig, ephemeral: true }).catch(() => null);

		await interaction.deferReply({ ephemeral: true }).catch(() => null);
		const result = await createTicket(this.client, interaction.guildId!, interaction.user, member, ticketType);
		await interaction.editReply({ content: result.ok ? MSG.ticketOpened(result.channelId) : result.message }).catch(() => null);
	}

	private async handleRemoveSelect(interaction: StringSelectMenuInteraction): Promise<void> {
		if (interaction.channel?.type !== ChannelType.GuildText) return;
		const channel = interaction.channel as TextChannel;
		const ticket = await this.client.prisma.tickets.findUnique({ where: { channelId: channel.id } });
		if (!ticket) return void interaction.update({ content: MSG.ticketNotFound, components: [] });

		const invited = (JSON.parse(ticket.invited) as string[]).filter((id) => !interaction.values.includes(id));
		await this.client.prisma.tickets.update({ where: { channelId: channel.id }, data: { invited: JSON.stringify(invited) } });

		for (const userId of interaction.values) {
			await channel.permissionOverwrites.delete(userId).catch(() => null);
			await logEvent(this.client, { type: "userRemoved", user: interaction.user, targetId: userId, channelId: channel.id, ticketId: ticket.id });
		}

		await interaction.update({ content: MSG.usersRemoved(interaction.values), components: [] });
	}

	/** The only remaining ticket-panel button: Claim (Close is /close-only — there's no button for it). */
	private async handleButton(interaction: ButtonInteraction): Promise<void> {
		if (interaction.channel?.type !== ChannelType.GuildText) return;
		const channel = interaction.channel as TextChannel;

		if (interaction.customId === "ticket_claim") {
			const member = interaction.member as GuildMember | null;
			const ticket = await this.client.prisma.tickets.findUnique({ where: { channelId: channel.id } });
			const ticketType = ticket ? getTicketType(this.client, ticket.typeCodeName) : undefined;
			if (!isStaffFor(this.client, member, ticketType)) return void interaction.reply({ content: MSG.claimOnlyStaff, ephemeral: true }).catch(() => null);

			const result = await claimTicket(this.client, channel, interaction.user);
			await interaction.reply({ content: result.ok ? MSG.claimed(interaction.user.id) : result.message, ephemeral: !result.ok }).catch(() => null);
			return;
		}

		if (interaction.customId === "ticket_delete") {
			await interaction.deferUpdate().catch(() => null);
			await deleteTicketChannel(this.client, channel, interaction.user);
			return;
		}
	}
}
