import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	MessageFlags,
	TextDisplayBuilder,
	type MessageCreateOptions,
} from "discord.js";
import ExtendedClient from "../structure/ExtendedClient";
import { resolveColor } from "../lib/tickets";
import { MSG } from "./messages";
import { brand } from "./theme";

/** Posted in the ticket channel right after it's closed. Components V2. */
export function buildChannelCloseNotice(
	client: ExtendedClient,
	closedById: string,
	reason: string | undefined,
	deleteDisabled: boolean
): MessageCreateOptions {
	const container = new ContainerBuilder()
		.setAccentColor(resolveColor(brand().colors.accent, "#B55CFF"))
		.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`# ${MSG.closedTitle}\n${MSG.closedBody(`<@${closedById}>`, reason?.trim() || MSG.noReasonGiven)}`)
		)
		.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId("ticket_delete").setLabel(MSG.deleteButton).setStyle(ButtonStyle.Danger).setDisabled(deleteDisabled)
			)
		);

	return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** DM'd to the ticket creator when their ticket is closed (if enabled in config). Components V2. */
export function buildDmCloseNotice(client: ExtendedClient, ticketNumber: number, reason?: string): MessageCreateOptions {
	const { colors, websiteUrl } = brand();

	const container = new ContainerBuilder()
		.setAccentColor(resolveColor(colors.accent, "#B55CFF"))
		.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`## Ticket Closed Notification\n\n` +
					`The ticket number **${ticketNumber}** has been closed by a staff member.\n\n` +
					`**Reason:**\n\`\`\`\n${reason?.trim() || MSG.noReasonGiven}\n\`\`\`\n\n` +
					`Please feel free to contact us again if you have any questions.`
			)
		)
		.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Website").setEmoji("🛒").setURL(websiteUrl),
				new ButtonBuilder()
					.setStyle(ButtonStyle.Link)
					.setLabel("Tickets")
					.setEmoji("🎫")
					.setURL(`https://discord.com/channels/${client.config.guildId}/${client.config.openTicketChannelId}`)
			)
		);

	return { flags: MessageFlags.IsComponentsV2, components: [container] };
}
