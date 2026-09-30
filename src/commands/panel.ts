import { ChannelType, ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder, TextChannel } from "discord.js";
import BaseCommand from "../structure/BaseCommand";
import { buildTicketPanel } from "../ui/panel";

export default class PanelCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("panel")
		.setDescription("Post the ticket panel in this channel")
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

	async execute(interaction: ChatInputCommandInteraction) {
		if (interaction.channel?.type !== ChannelType.GuildText)
			return interaction.reply({ content: "This can only be used in a text channel.", ephemeral: true });

		const sent = await (interaction.channel as TextChannel).send(buildTicketPanel(this.client));
		await this.client.prisma.config.upsert({
			where: { key: "panelMessageId" },
			create: { key: "panelMessageId", value: sent.id },
			update: { value: sent.id },
		});

		await interaction.reply({ content: "Panel posted.", ephemeral: true });
	}
}
