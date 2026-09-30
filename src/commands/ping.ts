import { ChatInputCommandInteraction, ContainerBuilder, MessageFlags, SlashCommandBuilder, TextDisplayBuilder } from "discord.js";
import BaseCommand from "../structure/BaseCommand";

/**
 * Example command — copy this file to add your own. Any file in src/commands/ that
 * default-exports a BaseCommand subclass is auto-loaded and auto-registered on startup.
 */
export default class PingCommand extends BaseCommand {
	public static data = new SlashCommandBuilder().setName("ping").setDescription("Check the bot's latency");

	async execute(interaction: ChatInputCommandInteraction) {
		const container = new ContainerBuilder()
			.setAccentColor(0x5865f2)
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# 🏓 Pong!\nWebSocket latency: \`${Math.round(this.client.ws.ping)}ms\``));

		await interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [container] });
	}
}
