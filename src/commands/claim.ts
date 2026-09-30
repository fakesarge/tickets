import { ChannelType, ChatInputCommandInteraction, GuildMember, SlashCommandBuilder, TextChannel } from "discord.js";
import BaseCommand from "../structure/BaseCommand";
import { getTicketType, isStaffFor } from "../lib/tickets";
import { claimTicket } from "../lib/ticketActions";
import { MSG } from "../ui/messages";

export default class ClaimCommand extends BaseCommand {
	public static data = new SlashCommandBuilder().setName("claim").setDescription("Set the ticket as claimed.");

	async execute(interaction: ChatInputCommandInteraction) {
		if (interaction.channel?.type !== ChannelType.GuildText) return interaction.reply({ content: MSG.notTicketChannel, ephemeral: true });

		const channel = interaction.channel as TextChannel;
		const ticket = await this.client.prisma.tickets.findUnique({ where: { channelId: channel.id } });
		if (!ticket) return interaction.reply({ content: MSG.ticketNotFound, ephemeral: true });

		const ticketType = getTicketType(this.client, ticket.typeCodeName);
		if (!isStaffFor(this.client, interaction.member as GuildMember | null, ticketType))
			return interaction.reply({ content: MSG.claimOnlyStaff, ephemeral: true });

		const result = await claimTicket(this.client, channel, interaction.user);
		await interaction.reply({ content: result.ok ? MSG.claimed(interaction.user.id) : result.message, ephemeral: !result.ok });
	}
}
