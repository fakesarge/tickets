import { ChannelType, ChatInputCommandInteraction, GuildMember, SlashCommandBuilder, TextChannel } from "discord.js";
import BaseCommand from "../structure/BaseCommand";
import { getTicketType, isStaffFor } from "../lib/tickets";
import { MSG } from "../ui/messages";

export default class RenameCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("rename")
		.setDescription("Rename the ticket")
		.addStringOption((o) => o.setName("name").setDescription("The new name of the ticket").setRequired(true));

	async execute(interaction: ChatInputCommandInteraction) {
		if (interaction.channel?.type !== ChannelType.GuildText) return interaction.reply({ content: MSG.notTicketChannel, ephemeral: true });

		const channel = interaction.channel as TextChannel;
		const ticket = await this.client.prisma.tickets.findUnique({ where: { channelId: channel.id } });
		if (!ticket) return interaction.reply({ content: MSG.ticketNotFound, ephemeral: true });

		const ticketType = getTicketType(this.client, ticket.typeCodeName);
		if (!isStaffFor(this.client, interaction.member as GuildMember | null, ticketType))
			return interaction.reply({ content: MSG.renameOnlyStaff, ephemeral: true });

		await channel.setName(interaction.options.getString("name", true));
		await interaction.reply({ content: MSG.renamed(channel.toString()) });
	}
}
