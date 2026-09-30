import {
	ActionRowBuilder,
	ChannelType,
	ChatInputCommandInteraction,
	SlashCommandBuilder,
	StringSelectMenuBuilder,
	TextChannel,
} from "discord.js";
import BaseCommand from "../structure/BaseCommand";
import { MSG } from "../ui/messages";

export default class RemoveCommand extends BaseCommand {
	public static data = new SlashCommandBuilder().setName("remove").setDescription("Remove someone from the ticket");

	async execute(interaction: ChatInputCommandInteraction) {
		if (interaction.channel?.type !== ChannelType.GuildText) return interaction.reply({ content: MSG.notTicketChannel, ephemeral: true });

		const channel = interaction.channel as TextChannel;
		const ticket = await this.client.prisma.tickets.findUnique({ where: { channelId: channel.id } });
		if (!ticket) return interaction.reply({ content: MSG.ticketNotFound, ephemeral: true });

		const invited = JSON.parse(ticket.invited) as string[];
		if (invited.length < 1) return interaction.reply({ content: MSG.noUsersToRemove, ephemeral: true });

		const users = await Promise.all(invited.map((id) => this.client.users.fetch(id).catch(() => null)));
		const options = users.filter((u): u is NonNullable<typeof u> => u !== null).map((u) => ({ label: u.tag, value: u.id }));
		if (options.length < 1) return interaction.reply({ content: MSG.noUsersToRemove, ephemeral: true });

		const select = new StringSelectMenuBuilder()
			.setCustomId("ticket_remove_select")
			.setPlaceholder(MSG.removePlaceholder)
			.setMinValues(1)
			.setMaxValues(options.length)
			.addOptions(options);

		await interaction.reply({ components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)] });
	}
}
