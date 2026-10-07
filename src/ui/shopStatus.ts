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
	TextDisplayBuilder,
	type MessageCreateOptions,
} from "discord.js";
import type ExtendedClient from "../structure/ExtendedClient";
import type { QueueLevel, ShopState } from "../lib/shopStatus";
import { ASSETS_DIR, V2_EPHEMERAL, brand } from "./theme";

const LOGO_FILE = "logo.png";
const BANNER_FILE = "banner.png";

const text = (body: string) => new TextDisplayBuilder().setContent(body);
const unix = (ms: number) => Math.floor(ms / 1000);
const gap = (spacing = SeparatorSpacingSize.Small) => new SeparatorBuilder().setDivider(false).setSpacing(spacing);

/** The branded divider: left corner + repeated middle + right corner. Null when the emojis aren't configured. */
export function barLine(client: ExtendedClient): string | null {
	const { barLeft, barMiddle, barRight } = brand().emojis;
	if (!barLeft || !barMiddle || !barRight) return null;
	const length = Math.min(Math.max(Math.floor(client.config.shopStatus?.barLength ?? 10), 1), 16);
	return `${barLeft}${barMiddle.repeat(length)}${barRight}`;
}

/** Adds a section break: the emoji bar when configured, otherwise a plain divider line. */
function addRule(container: ContainerBuilder, client: ExtendedClient, spacing = SeparatorSpacingSize.Small): void {
	const bar = barLine(client);
	if (!bar) {
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(spacing));
		return;
	}
	container.addSeparatorComponents(gap(spacing)).addTextDisplayComponents(text(bar)).addSeparatorComponents(gap(SeparatorSpacingSize.Small));
}

const OPEN_COLOR = 0x3ba55c;
const CLOSED_COLOR = 0xed4245;
const SALE_COLOR = 0xfaa61a;

export const QUEUE_INFO: Record<QueueLevel, { emoji: string; label: string; blurb: string; meter: string }> = {
	low: { emoji: "🟢", label: "Low", blurb: "Quick turnaround — order now!", meter: "🟩⬛⬛⬛" },
	medium: { emoji: "🟡", label: "Medium", blurb: "A short wait before we start.", meter: "🟨🟨⬛⬛" },
	high: { emoji: "🟠", label: "High", blurb: "Expect a longer wait right now.", meter: "🟧🟧🟧⬛" },
	full: { emoji: "🔴", label: "Full", blurb: "Not taking new orders until the queue clears.", meter: "🟥🟥🟥🟥" },
};

function asset(name: string): AttachmentBuilder | null {
	const file = path.join(ASSETS_DIR, name);
	return fs.existsSync(file) ? new AttachmentBuilder(file, { name }) : null;
}

function linkRow(client: ExtendedClient): ActionRowBuilder<ButtonBuilder> {
	const buttons = [new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Website").setEmoji("🛒").setURL(brand().websiteUrl)];
	if (client.config.openTicketChannelId) {
		buttons.push(
			new ButtonBuilder()
				.setStyle(ButtonStyle.Link)
				.setLabel("Open a ticket")
				.setEmoji("🎫")
				.setURL(`https://discord.com/channels/${client.config.guildId}/${client.config.openTicketChannelId}`)
		);
	}
	return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
}

/** Heading text with the logo to its right (falls back to plain text if the logo file is missing). */
function addHeader(container: ContainerBuilder, headingText: string, files: AttachmentBuilder[]): void {
	const logo = asset(LOGO_FILE);
	if (!logo) {
		container.addTextDisplayComponents(text(headingText));
		return;
	}
	files.push(logo);
	container.addSectionComponents((section: SectionBuilder) =>
		section.addTextDisplayComponents(text(headingText)).setThumbnailAccessory((t) => t.setURL(`attachment://${LOGO_FILE}`))
	);
}

function saleBlock(state: ShopState): string | null {
	const { sale } = state;
	if (sale.state === "off") return null;
	const { bullet } = brand().emojis;
	const badge = sale.state === "ending" ? "⏳ **ENDING SOON**" : "🔥 **LIVE NOW**";
	const ends = sale.endsAt ? `\n⏰ Ends <t:${unix(sale.endsAt)}:R> · <t:${unix(sale.endsAt)}:f>` : "";
	return `### ${bullet} 🎉 ${sale.name || "Sale"}\n${badge}${sale.details ? `\n${sale.details}` : ""}${ends}`;
}

/** The single, always-current message in the status channel. `lines` is the live "what we're up to" section. */
export function buildStatusBoard(client: ExtendedClient, state: ShopState, lines: string[], opts: { ephemeral?: boolean } = {}) {
	const { name, emojis } = brand();
	const open = state.store === "open";
	const files: AttachmentBuilder[] = [];

	const accent = state.sale.state !== "off" && open ? SALE_COLOR : open ? OPEN_COLOR : CLOSED_COLOR;
	const container = new ContainerBuilder().setAccentColor(accent);

	addHeader(
		container,
		`-# ${name.toUpperCase()} · LIVE SHOP STATUS\n# ${open ? "🟢 We're Open" : "🔴 Closed for Today"}\n${state.storeNote || (open ? "The store is open and taking orders." : "We'll be back soon — thanks for your patience.")}`,
		files
	);

	const banner = asset(BANNER_FILE);
	if (banner) {
		files.push(banner);
		container.addSeparatorComponents(gap()).addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${BANNER_FILE}`)));
	}

	const blocks: string[] = [];
	if (state.queue !== "off") {
		const q = QUEUE_INFO[state.queue];
		blocks.push(`### ${emojis.bullet} Order Queue\n${q.meter}  **${q.label}**\n-# ${q.blurb}`);
	}
	const sale = saleBlock(state);
	if (sale) blocks.push(sale);
	if (state.note) blocks.push(`### ${emojis.bullet} 📢 Notice\n${state.note}`);
	if (lines.length) blocks.push(`### ${emojis.bullet} What We're Up To\n${lines.join("\n")}`);

	for (const block of blocks) {
		addRule(container, client);
		container.addTextDisplayComponents(text(block));
	}

	addRule(container, client);
	container
		.addTextDisplayComponents(text(`-# Updated <t:${unix(state.updatedAt)}:R> · This board updates automatically`))
		.addActionRowComponents(linkRow(client));

	return { flags: opts.ephemeral ? V2_EPHEMERAL : MessageFlags.IsComponentsV2, components: [container], files };
}

export type Announcement =
	| { type: "store"; state: ShopState }
	| { type: "queue"; level: QueueLevel | "off" }
	| { type: "sale"; state: "live" | "ending" | "off"; name?: string; details?: string; endsAt?: number }
	| { type: "custom"; message: string };

/** The "what just changed" post. Pings the configured role (if any), as plain text above the card, so people actually see it. */
export function buildAnnouncement(client: ExtendedClient, a: Announcement, pingRoleId?: string): MessageCreateOptions {
	const { name } = brand();
	let color = OPEN_COLOR;
	let kind: string;
	let title: string;
	let body: string;

	switch (a.type) {
		case "store": {
			const open = a.state.store === "open";
			color = open ? OPEN_COLOR : CLOSED_COLOR;
			kind = "STORE UPDATE";
			title = open ? "🟢 We're Open!" : "🔴 Closed for Today";
			body = a.state.storeNote || (open ? "The store is open and taking orders — come say hi!" : "The store is closed for today. We'll be back soon.");
			break;
		}
		case "queue": {
			kind = "QUEUE UPDATE";
			if (a.level === "off") {
				title = "📋 Queue update";
				body = "We're no longer showing a queue level.";
			} else {
				const q = QUEUE_INFO[a.level];
				color = a.level === "full" ? CLOSED_COLOR : a.level === "low" ? OPEN_COLOR : SALE_COLOR;
				title = `${q.emoji} Queue is ${q.label}`;
				body = `${q.meter}  **${q.label}**\n${q.blurb}`;
			}
			break;
		}
		case "sale": {
			const sale = a.name || "Sale";
			color = SALE_COLOR;
			kind = "SALE ALERT";
			const ends = a.endsAt ? `\n\n⏰ Ends <t:${unix(a.endsAt)}:R> · <t:${unix(a.endsAt)}:f>` : "";
			if (a.state === "live") {
				title = `🎉 ${sale} Has Started!`;
				body = `🔥 **LIVE NOW**\n${a.details || "Grab it while it lasts."}${ends}`;
			} else if (a.state === "ending") {
				title = `⏳ ${sale} Is Ending Soon`;
				body = `**Last chance!**\n${a.details || "Don't miss out."}${ends}`;
			} else {
				color = CLOSED_COLOR;
				title = `🏁 ${sale} Has Ended`;
				body = "Thanks to everyone who grabbed it! Keep an eye on this channel for the next one.";
			}
			break;
		}
		case "custom":
			kind = "ANNOUNCEMENT";
			title = "📢 Announcement";
			body = a.message;
			color = parseInt(brand().colors.accent.replace("#", ""), 16) || 0xb55cff;
			break;
	}

	const files: AttachmentBuilder[] = [];
	const container = new ContainerBuilder().setAccentColor(color);
	addHeader(container, `-# ${name.toUpperCase()} · ${kind}\n# ${title}\n${body}`, files);
	addRule(container, client);
	container
		.addTextDisplayComponents(text(`-# <t:${unix(Date.now())}:f>`))
		.addActionRowComponents(linkRow(client));

	const components = [...(pingRoleId ? [text(`<@&${pingRoleId}>`)] : []), container];
	return {
		flags: MessageFlags.IsComponentsV2,
		components,
		allowedMentions: pingRoleId ? { roles: [pingRoleId] } : { parse: [] },
		...(files.length ? { files } : {}),
	};
}
