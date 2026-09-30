import { ChannelType, ChatInputCommandInteraction, SlashCommandBuilder, TextChannel } from "discord.js";
import BaseCommand from "../structure/BaseCommand";
import { logEvent } from "../lib/logs";
import { MSG } from "../ui/messages";

export default class AddCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("add")
		.setDescription("Add someone to the ticket")
		.addUserOption((o) => o.setName("user").setDescription("The user to add").setRequired(true));

	async execute(interaction: ChatInputCommandInteraction) {
		if (interaction.channel?.type !== ChannelType.GuildText) return interaction.reply({ content: MSG.notTicketChannel, ephemeral: true });

		const user = interaction.options.getUser("user", true);
		const channel = interaction.channel as TextChannel;
		const ticket = await this.client.prisma.tickets.findUnique({ where: { channelId: channel.id } });
		if (!ticket) return interaction.reply({ content: MSG.ticketNotFound, ephemeral: true });

		const invited = JSON.parse(ticket.invited) as string[];
		if (invited.includes(user.id)) return interaction.reply({ content: MSG.userAlreadyAdded, ephemeral: true });
		if (invited.length >= 25) return interaction.reply({ content: MSG.tooManyUsers, ephemeral: true });

		invited.push(user.id);
		await this.client.prisma.tickets.update({ where: { channelId: channel.id }, data: { invited: JSON.stringify(invited) } });
		await channel.permissionOverwrites.edit(user, {
			SendMessages: true,
			AddReactions: true,
			ReadMessageHistory: true,
			AttachFiles: true,
			ViewChannel: true,
		});

		await interaction.reply({ content: MSG.userAdded(user.id) });
		await logEvent(this.client, { type: "userAdded", user: interaction.user, targetId: user.id, channelId: channel.id, ticketId: ticket.id });
	}
}
