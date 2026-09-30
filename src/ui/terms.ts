import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	MessageFlags,
	SectionBuilder,
	TextDisplayBuilder,
	type MessageCreateOptions,
	type MessageEditOptions,
} from "discord.js";
import { resolveColor } from "../lib/tickets";
import { LRM, brand } from "./theme";

function heading(): string {
	return `# 📝 ${brand().name} Terms And Conditions`;
}

/** Replaces the ticket's welcome panel with the "agree / decline" prompt. Components V2. */
export function buildTermsPromptPayload(): MessageCreateOptions & MessageEditOptions {
	const { websiteUrl, colors } = brand();

	const body =
		`${heading()}\n${LRM} \n` +
		`${LRM}Bellow is a option to proceed with our terms and conditions, please find them at out website using the link provided. ` +
		`If you do chose to opt out your ticket will be closed and you will not be offered service.\n${LRM} \n` +
		`[Website — full terms](${websiteUrl})`;

	const container = new ContainerBuilder()
		.setAccentColor(resolveColor(colors.accent, "#B55CFF"))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
		.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId("tosAgree").setLabel("Agree To Terms").setStyle(ButtonStyle.Success).setEmoji("🖋️"),
				new ButtonBuilder().setCustomId("tosDecline").setLabel("Decline Agreement").setStyle(ButtonStyle.Danger).setEmoji("🛑")
			)
		);

	return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** What the terms prompt is edited into once the customer has signed. Components V2. */
export function buildTermsSignedPayload(signature: string): MessageEditOptions {
	const { websiteUrl, colors } = brand();
	const safeSignature = signature.replace(/```/g, "``​`");

	const body = `${heading()}\n${LRM} Signed and completed\n\`\`\`\n${safeSignature}\n\`\`\`${LRM} `;

	const section = new SectionBuilder()
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
		.setButtonAccessory(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Website").setURL(websiteUrl));

	const container = new ContainerBuilder().setAccentColor(resolveColor(colors.accent, "#B55CFF")).addSectionComponents(section);

	return { flags: MessageFlags.IsComponentsV2, components: [container], embeds: [] };
}
