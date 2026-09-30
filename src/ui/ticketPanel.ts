import fs from "node:fs";
import path from "node:path";
import {
	ActionRowBuilder,
	APIButtonComponent,
	APIContainerComponent,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	ContainerBuilder,
	Message,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder,
	MessageFlags,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
	type MessageCreateOptions,
	type MessageEditOptions,
} from "discord.js";
import ExtendedClient from "../structure/ExtendedClient";
import { resolveColor } from "../lib/tickets";
import { ASSETS_DIR, brand } from "./theme";
import { MSG } from "./messages";

const WELCOME_BANNER_FILE = "ticketwelcome.png";
const FALLBACK_BANNER_FILE = "banner.png";

function assetIfExists(name: string): string | undefined {
	const file = path.join(ASSETS_DIR, name);
	return fs.existsSync(file) ? file : undefined;
}

function buildClaimRow(client: ExtendedClient): ActionRowBuilder<ButtonBuilder> | null {
	if (!client.config.claim.enabled || !client.config.claim.showButton) return null;
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId("ticket_claim").setLabel("Claim").setEmoji("🙋").setStyle(ButtonStyle.Secondary)
	);
}

/**
 * The single first message in a ticket channel: a welcome panel with a "Continue" button that
 * reveals the terms prompt in place (see the "ticketShowTerms" handler) — this same message is
 * later edited into the terms prompt, then the signed confirmation. Components V2.
 */
export function buildTicketPanelPayload(client: ExtendedClient, userId: string): MessageCreateOptions {
	const { emojis } = brand();
	const container = new ContainerBuilder().setAccentColor(resolveColor(brand().colors.accent, "#B55CFF"));

	container.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(
			`# ${emojis.relay}  Customer Support Panel\n` +
				"**Thank you** for reaching out to our support team. Please follow the instructions I provide to make it easier for the staff team to understand your issue!\n\n" +
				`Ticket Opened by - <@${userId}>`
		)
	);

	const files: AttachmentBuilder[] = [];
	const bannerPath = assetIfExists(WELCOME_BANNER_FILE) ?? assetIfExists(FALLBACK_BANNER_FILE);
	if (bannerPath) {
		const name = path.basename(bannerPath);
		files.push(new AttachmentBuilder(bannerPath, { name }));
		container
			.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
			.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`)));
	} else {
		console.warn(`Ticket panel: no image found in assets/ for the welcome banner (expected ${WELCOME_BANNER_FILE} or ${FALLBACK_BANNER_FILE}).`);
	}

	container.addActionRowComponents(
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("ticketShowTerms").setLabel("Continue").setEmoji("📝").setStyle(ButtonStyle.Secondary)
		)
	);

	const claimRow = buildClaimRow(client);
	if (claimRow) container.addActionRowComponents(claimRow);

	return { flags: MessageFlags.IsComponentsV2, components: [container], ...(files.length > 0 ? { files } : {}) };
}

/**
 * Appends a "Claimed By" note to the ticket's current panel/terms message and disables its
 * Claim button, in place — without touching whatever else is currently in the container
 * (welcome panel, terms prompt, or signed confirmation). No-op if the message isn't Components V2.
 */
export async function markClaimedOnMessage(msg: Message, claimedById: string): Promise<void> {
	if (!msg.flags.has(MessageFlags.IsComponentsV2)) return;

	const raw = msg.components[0];
	if (!raw || raw.type !== ComponentType.Container) return;

	const container = new ContainerBuilder(raw.data as APIContainerComponent);
	for (const comp of container.components) {
		if (comp.data.type === ComponentType.TextDisplay) {
			(comp as TextDisplayBuilder).setContent(`${comp.data.content}\n\n${MSG.claimedBy(claimedById)}`);
		}
		if (comp.data.type === ComponentType.ActionRow) {
			const row = comp as ActionRowBuilder<ButtonBuilder>;
			for (const btn of row.components) {
				if (btn.data.type !== ComponentType.Button) continue;
				const data = btn.data as APIButtonComponent;
				const customId = "custom_id" in data ? data.custom_id : undefined;
				if (customId === "ticket_claim") btn.setDisabled(true);
			}
		}
	}

	await msg.edit({ flags: MessageFlags.IsComponentsV2, components: [container] } as MessageEditOptions).catch((e) => console.error(e));
}
