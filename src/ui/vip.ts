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
import { V2_EPHEMERAL, brand } from "./theme";

type Reply = { flags: typeof V2_EPHEMERAL; components: ContainerBuilder[] };

const full = (ms: number) => `<t:${Math.floor(ms / 1000)}:F>`;
const relative = (ms: number) => `<t:${Math.floor(ms / 1000)}:R>`;

function container(body: string, color?: string | number): ContainerBuilder {
	const accent = typeof color === "number" ? color : resolveColor(color ?? brand().colors.accent, "#B55CFF");
	return new ContainerBuilder().setAccentColor(accent).addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

const reply = (c: ContainerBuilder): Reply => ({ flags: V2_EPHEMERAL, components: [c] });

/** What `/vip check` shows. `self` switches the wording between "you" and a mention. */
export function buildVipStatusPayload(userId: string, vip: { expiresAt: number } | null, self: boolean, now = Date.now()): Reply {
	const who = self ? "You" : `<@${userId}>`;
	const have = self ? "have" : "has";

	if (!vip) return reply(container(`## ⭐ VIP\n${who} ${have === "have" ? "don't" : "doesn't"} have VIP.`, 0x80848e));

	if (vip.expiresAt > now) {
		return reply(container(`## ⭐ VIP active\n${who} ${have} VIP.\n\n**Expires:** ${full(vip.expiresAt)} (${relative(vip.expiresAt)})`, 0x3ba55c));
	}
	return reply(container(`## ⭐ VIP expired\n${self ? "Your" : `<@${userId}>'s`} VIP expired on ${full(vip.expiresAt)} (${relative(vip.expiresAt)}).`, 0xed4245));
}

export function buildVipGrantedPayload(userId: string, expiresAt: number): Reply {
	return reply(container(`## ⭐ VIP set\n<@${userId}> now has VIP.\n\n**Expires:** ${full(expiresAt)} (${relative(expiresAt)})`, 0x3ba55c));
}

export function buildVipListPayload(vips: { discordId: string; expiresAt: number }[]): Reply {
	if (vips.length === 0) return reply(container("## ⭐ Active VIPs\nNobody has active VIP right now.", 0x80848e));

	const shown = vips.slice(0, 25);
	const lines = shown.map((v) => `<@${v.discordId}> — expires ${full(v.expiresAt)} (${relative(v.expiresAt)})`).join("\n");
	const more = vips.length > shown.length ? `\n\n-# Showing the ${shown.length} soonest-expiring of ${vips.length}.` : "";
	return reply(container(`## ⭐ Active VIPs (${vips.length})\n${lines}${more}`));
}

/** DM'd to a VIP member REMINDER_DAYS before their membership ends. */
export function buildVipReminderDm(client: ExtendedClient, expiresAt: number): MessageCreateOptions {
	const { websiteUrl } = brand();
	const c = container(
		`## ⭐ Your VIP is expiring soon\nYour VIP membership ends ${relative(expiresAt)} (${full(expiresAt)}).\n\nWant to keep it? Open a ticket and we'll get you renewed before it lapses.`
	).addActionRowComponents(
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Website").setEmoji("🛒").setURL(websiteUrl),
			new ButtonBuilder()
				.setStyle(ButtonStyle.Link)
				.setLabel("Tickets")
				.setEmoji("🎫")
				.setURL(`https://discord.com/channels/${client.config.guildId}/${client.config.openTicketChannelId}`)
		)
	);
	return { flags: MessageFlags.IsComponentsV2, components: [c] };
}
