import { AutocompleteInteraction, ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from "discord.js";
import BaseCommand from "../structure/BaseCommand";
import { AffiliateError, clearUsedCode, getUsedCode, searchCodes } from "../lib/affiliate";
import { applyCode } from "../lib/affiliateShare";
import { Panel, buildCodeClearedPayload, buildCodeViewPayload, buildSupportAnnouncementPayload, personOf } from "../ui/affiliate";
import { MSG } from "../ui/messages";

export default class CodeCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("code")
		.setDescription("Support a creator by using their affiliate code")
		.addSubcommand((s) =>
			s
				.setName("use")
				.setDescription("Use a creator's code to support them")
				.addStringOption((o) => o.setName("code").setDescription("The creator's code").setRequired(true).setMaxLength(20).setAutocomplete(true))
		)
		.addSubcommand((s) => s.setName("view").setDescription("Show which creator you're supporting"))
		.addSubcommand((s) => s.setName("clear").setDescription("Stop using your current creator code"));

	async autocomplete(interaction: AutocompleteInteraction) {
		const codes = await searchCodes(this.client.prisma, interaction.options.getFocused());
		return interaction.respond(codes.map((code) => ({ name: code, value: code })));
	}

	async execute(interaction: ChatInputCommandInteraction) {
		const { prisma } = this.client;
		const sub = interaction.options.getSubcommand();
		const show = (panel: Panel) =>
			interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: panel.components as never, allowedMentions: { parse: [] } });

		try {
			// Supporting a creator is public — it promotes them. The work happens before replying so a bad
			// code can be answered privately instead of announcing a failure to the whole channel.
			if (sub === "use") {
				const { affiliate, previous, creator } = await applyCode(this.client, interaction.user.id, interaction.options.getString("code", true));
				await interaction.deferReply();
				return void (await show(buildSupportAnnouncementPayload(interaction.user.id, creator, affiliate, previous)));
			}

			if (sub === "view") {
				const used = await getUsedCode(prisma, interaction.user.id);
				await interaction.deferReply(used ? {} : { flags: MessageFlags.Ephemeral });
				const creator = used ? await this.client.users.fetch(used.affiliate.discordId).catch(() => null) : null;
				return void (await show(buildCodeViewPayload(interaction.user.id, creator ? personOf(creator) : null, used)));
			}

			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			return void (await show(buildCodeClearedPayload(await clearUsedCode(prisma, interaction.user.id))));
		} catch (err) {
			const content = err instanceof AffiliateError ? err.message : MSG.commandError;
			if (!(err instanceof AffiliateError)) console.error(`/code ${sub} failed:`, err);
			if (!interaction.deferred && !interaction.replied) return void (await interaction.reply({ content, flags: MessageFlags.Ephemeral }));
			await interaction.deleteReply().catch(() => null);
			await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
		}
	}
}
