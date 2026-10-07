import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, TextDisplayBuilder, type MessageCreateOptions } from "discord.js";
import ExtendedClient from "../structure/ExtendedClient";
import { Order, formatPrice, statusInfo, unixSeconds } from "../lib/orders";
import { resolveColor } from "../lib/tickets";
import { V2_EPHEMERAL, brand } from "./theme";

type Reply = { flags: typeof V2_EPHEMERAL; components: ContainerBuilder[] };

const reply = (c: ContainerBuilder): Reply => ({ flags: V2_EPHEMERAL, components: [c] });
const text = (body: string) => new TextDisplayBuilder().setContent(body);

/** A compact list. Capped so it always fits in one message. */
export function buildOrderListPayload(orders: Order[], title: string, total?: number): Reply {
	const accent = resolveColor(brand().colors.accent, "#B55CFF");
	if (orders.length === 0) return reply(new ContainerBuilder().setAccentColor(accent).addTextDisplayComponents(text(`## 📦 ${title}\nNo orders found.`)));

	const shown = orders.slice(0, 10);
	const lines = shown
		.map((o) => {
			const s = statusInfo(o.status);
			return `${s.emoji} **${o.order_name}** — \`${o.order_code}\`\n-# ${s.label} · ${formatPrice(o.price)} · <t:${unixSeconds(o.created_at)}:d>`;
		})
		.join("\n");

	const count = total ?? orders.length;
	const more = count > shown.length ? `\n\n-# Showing the ${shown.length} most recent of ${count}. Use \`/order view\` for details.` : "\n\n-# Use `/order view` for details on any order.";
	return reply(new ContainerBuilder().setAccentColor(accent).addTextDisplayComponents(text(`## 📦 ${title}\n${lines}${more}`)));
}

/** One order in full. `admin` adds the customer line; `heading` lets the caller say "Order created" etc. */
export function buildOrderDetailPayload(order: Order, opts: { admin: boolean; heading?: string; footnote?: string }): Reply {
	const s = statusInfo(order.status);
	const customer = opts.admin ? `\n**Customer:** ${order.customer_name}${order.discord_id ? ` (<@${order.discord_id}>)` : ""}` : "";
	const description = order.description?.trim() ? `\n\n${order.description.trim()}` : "";

	const body =
		`## ${opts.heading ?? "📦 Order"} — ${order.order_name}\n` +
		`**Code:** \`${order.order_code}\`\n` +
		`**Status:** ${s.emoji} ${s.label}\n` +
		`**Price:** ${formatPrice(order.price)}\n` +
		`**Category:** ${order.category} · **Service:** ${order.service}` +
		customer +
		`\n**Created:** <t:${unixSeconds(order.created_at)}:f>\n**Last update:** <t:${unixSeconds(order.updated_at)}:R>` +
		description +
		(opts.footnote ? `\n\n-# ${opts.footnote}` : "");

	return reply(new ContainerBuilder().setAccentColor(s.color).addTextDisplayComponents(text(body)));
}

const STATUS_MESSAGE: Record<string, string> = {
	pending: "Your order is in the queue — we'll get started on it soon.",
	in_progress: "We've started working on your order.",
	completed: "Your order is complete! Thanks for choosing us.",
	cancelled: "Your order was cancelled. If that's unexpected, open a ticket and we'll sort it out.",
};

/** DM'd to the customer when an admin changes their order's status. */
export function buildOrderStatusDm(client: ExtendedClient, order: Order, previousStatus: string): MessageCreateOptions {
	const before = statusInfo(previousStatus);
	const now = statusInfo(order.status);
	const body =
		`## 📦 Order update — ${order.order_name}\n` +
		`${before.emoji} ${before.label}  →  ${now.emoji} **${now.label}**\n\n` +
		`${STATUS_MESSAGE[order.status] ?? "Your order status has changed."}\n\n` +
		`**Code:** \`${order.order_code}\` · **Price:** ${formatPrice(order.price)}\n` +
		`-# See all your orders any time with \`/order list\`.`;

	const container = new ContainerBuilder()
		.setAccentColor(now.color)
		.addTextDisplayComponents(text(body))
		.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Website").setEmoji("🛒").setURL(brand().websiteUrl),
				new ButtonBuilder()
					.setStyle(ButtonStyle.Link)
					.setLabel("Tickets")
					.setEmoji("🎫")
					.setURL(`https://discord.com/channels/${client.config.guildId}/${client.config.openTicketChannelId}`)
			)
		);
	return { flags: MessageFlags.IsComponentsV2, components: [container] };
}
