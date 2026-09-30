import { ChannelType, ChatInputCommandInteraction, GuildMember, SlashCommandBuilder, TextChannel } from "discord.js";
import BaseCommand from "../structure/BaseCommand";
import { canCloseTicket, getTicketType } from "../lib/tickets";
import { closeAndReply } from "../lib/ticketActions";
import { MSG } from "../ui/messages";

export default class CloseCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("close")
		.setDescription("Close the ticket")
		.addStringOption((o) => o.setName("reason").setDescription("Why the ticket is being closed").setRequired(true));

	async execute(interaction: ChatInputCommandInteraction) {
		if (interaction.channel?.type !== ChannelType.GuildText) return interaction.reply({ content: MSG.notTicketChannel, ephemeral: true });

		const channel = interaction.channel as TextChannel;
		const ticket = await this.client.prisma.tickets.findUnique({ where: { channelId: channel.id } });
		if (!ticket) return interaction.reply({ content: MSG.ticketNotFound, ephemeral: true });

		const ticketType = getTicketType(this.client, ticket.typeCodeName);
		if (!canCloseTicket(this.client, interaction.member as GuildMember | null, ticketType))
			return interaction.reply({ content: MSG.closeOnlyStaff, ephemeral: true });

		await interaction.deferReply();
		await closeAndReply(interaction, this.client, channel, interaction.options.getString("reason", true));
	}
}
