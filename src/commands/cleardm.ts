import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import BaseCommand from "../structure/BaseCommand";
import { MSG } from "../ui/messages";

export default class ClearDmCommand extends BaseCommand {
	public static data = new SlashCommandBuilder().setName("cleardm").setDescription("Clear all of your ticket history in your DM");

	async execute(interaction: ChatInputCommandInteraction) {
		await interaction.deferReply({ ephemeral: true });

		const dm = await interaction.user.createDM();
		let batch = await dm.messages.fetch({ limit: 100 });

		while (batch.size > 0) {
			for (const msg of batch.filter((m) => m.author.id === this.client.user?.id).values()) await msg.delete().catch(() => null);
			if (batch.size < 100) break;
			batch = await dm.messages.fetch({ limit: 100, before: batch.last()?.id });
		}

		await interaction.followUp({ content: MSG.dmCleared, ephemeral: true });
	}
}
