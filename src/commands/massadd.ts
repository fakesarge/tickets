import { ChannelType, ChatInputCommandInteraction, SlashCommandBuilder, TextChannel } from "discord.js";
import BaseCommand from "../structure/BaseCommand";
import { logEvent } from "../lib/logs";
import { MSG } from "../ui/messages";

export default class MassAddCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("massadd")
		.setDescription("Add multiple users to the ticket. It's recommended to use the regular add command when possible.")
		.addStringOption((o) => o.setName("users").setDescription("Users to add. Use ',' as seperator.").setRequired(true));

	async execute(interaction: ChatInputCommandInteraction) {
		if (interaction.channel?.type !== ChannelType.GuildText) return interaction.reply({ content: MSG.notTicketChannel, ephemeral: true });

		const ids = interaction.options
			.getString("users", true)
			.split(",")
			.map((s) => s.trim().replace(/[<@!>]/g, ""))
			.filter(Boolean);

		if (ids.length === 0) return interaction.reply({ content: MSG.needAtLeastOneUser, ephemeral: true });
		if (ids.length > 25) return interaction.reply({ content: MSG.tooManyUsers, ephemeral: true });

		const channel = interaction.channel as TextChannel;
		const ticket = await this.client.prisma.tickets.findUnique({ where: { channelId: channel.id } });
		if (!ticket) return interaction.reply({ content: MSG.ticketNotFound, ephemeral: true });

		await interaction.deferReply();

		const invited = JSON.parse(ticket.invited) as string[];
		for (const id of ids) {
			if (invited.includes(id) || invited.length >= 25) continue;
			const user = await this.client.users.fetch(id).catch(() => null);
			if (!user) continue;

			invited.push(id);
			await channel.permissionOverwrites.edit(user, {
				SendMessages: true,
				AddReactions: true,
				ReadMessageHistory: true,
				AttachFiles: true,
				ViewChannel: true,
			});
			await logEvent(this.client, { type: "userAdded", user: interaction.user, targetId: user.id, channelId: channel.id, ticketId: ticket.id });
		}

		await this.client.prisma.tickets.update({ where: { channelId: channel.id }, data: { invited: JSON.stringify(invited) } });
		await interaction.editReply({ content: MSG.massAddDone });
	}
}
