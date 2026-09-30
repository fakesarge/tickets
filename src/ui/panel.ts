import fs from "node:fs";
import path from "node:path";
import {
	ActionRowBuilder,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder,
	MessageFlags,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	StringSelectMenuBuilder,
	TextDisplayBuilder,
	type MessageCreateOptions,
} from "discord.js";
import ExtendedClient from "../structure/ExtendedClient";
import { ButtonStyleName, TicketType } from "../lib/types";
import { resolveColor } from "../lib/tickets";
import { ASSETS_DIR, LRM, brand } from "./theme";

const THUMBNAIL_FILE = "logo.png";
const BANNER_FILE = "banner.png";
const MAX_BUTTON_TYPES = 10;

const STYLES: Record<ButtonStyleName, ButtonStyle> = {
	Primary: ButtonStyle.Primary,
	Secondary: ButtonStyle.Secondary,
	Success: ButtonStyle.Success,
	Danger: ButtonStyle.Danger,
};

function assetIfExists(name: string): string | undefined {
	const file = path.join(ASSETS_DIR, name);
	return fs.existsSync(file) ? file : undefined;
}

function typeButton(type: TicketType): ButtonBuilder {
	const button = new ButtonBuilder()
		.setCustomId(`openTicket_${type.codeName}`)
		.setLabel(type.name)
		.setStyle(STYLES[type.buttonStyle ?? "Secondary"]);
	const emoji = type.buttonEmoji || type.emoji;
	if (emoji) button.setEmoji(emoji);
	return button;
}

function typeSelect(types: TicketType[]): ActionRowBuilder<StringSelectMenuBuilder> {
	return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
		new StringSelectMenuBuilder()
			.setCustomId("ticket_open_select")
			.setPlaceholder("Select a ticket type")
			.addOptions(
				types.map((t) => ({
					label: t.name,
					value: t.codeName,
					description: t.description.slice(0, 100),
					emoji: t.emoji || undefined,
				}))
			)
	);
}

/** Splits the ticket types into rows of up to five buttons, or a single select menu when there are many. */
function typeRows(types: TicketType[]): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
	if (types.length > MAX_BUTTON_TYPES) return [typeSelect(types) as ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>];

	const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
	for (let i = 0; i < types.length; i += 5) {
		rows.push(new ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>().addComponents(types.slice(i, i + 5).map(typeButton)));
	}
	return rows;
}

/** The panel customers use to open a ticket. Components V2. */
export function buildTicketPanel(client: ExtendedClient): MessageCreateOptions {
	const { panel, colors, emojis } = brand();

	const container = new ContainerBuilder().setAccentColor(resolveColor(colors.panel, "#B34BFC"));
	const files: AttachmentBuilder[] = [];

	const headingText = new TextDisplayBuilder().setContent(
		`# ${panel.heading}\n${panel.subheading}\n\n` + `### ${emojis.bullet} ${panel.notice} ${LRM} ${LRM} ${LRM}\n\n`
	);

	const thumbnail = assetIfExists(THUMBNAIL_FILE);
	if (thumbnail) {
		files.push(new AttachmentBuilder(thumbnail, { name: THUMBNAIL_FILE }));
		container.addSectionComponents((section: SectionBuilder) =>
			section.addTextDisplayComponents(headingText).setThumbnailAccessory((t) => t.setURL(`attachment://${THUMBNAIL_FILE}`))
		);
	} else {
		console.warn(`Ticket panel: assets/${THUMBNAIL_FILE} not found — panel will have no thumbnail.`);
		container.addTextDisplayComponents(headingText);
	}

	const banner = assetIfExists(BANNER_FILE);
	if (banner) {
		files.push(new AttachmentBuilder(banner, { name: BANNER_FILE }));
		container
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
			.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${BANNER_FILE}`)));
	} else {
		console.warn(`Ticket panel: assets/${BANNER_FILE} not found — panel will have no banner.`);
	}

	container
		.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${panel.footer}`));

	for (const row of typeRows(client.config.ticketTypes)) container.addActionRowComponents(row);

	return {
		flags: MessageFlags.IsComponentsV2,
		components: [container],
		...(files.length > 0 ? { files } : {}),
	};
}
