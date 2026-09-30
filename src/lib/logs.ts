import { ChannelType, ContainerBuilder, MessageFlags, SectionBuilder, TextChannel, TextDisplayBuilder, ThumbnailBuilder, User } from "discord.js";
import ExtendedClient from "../structure/ExtendedClient";
import { msToHm } from "./tickets";
import { MSG } from "../ui/messages";

export type LogEvent =
	| { type: "ticketCreate"; user: User; channelId: string; reason?: string }
	| { type: "ticketClaim"; user: User; channelId: string; ticketId: number; createdAt: number | bigint }
	| { type: "ticketClose"; user: User; channelId: string; ticketId: number; createdAt: number | bigint; reason?: string }
	| { type: "ticketDelete"; user: User; ticketId: number; createdAt: number | bigint }
	| { type: "userAdded"; user: User; targetId: string; channelId: string; ticketId: number }
	| { type: "userRemoved"; user: User; targetId: string; channelId: string; ticketId: number };

const STYLE: Record<LogEvent["type"], { color: number; heading: string }> = {
	ticketCreate: { color: 0x3ba55c, heading: "🎫 Ticket Created" },
	ticketClaim: { color: 0xfaa61a, heading: "🙋 Ticket Claimed" },
	ticketClose: { color: 0xed4245, heading: "🔒 Ticket Closed" },
	ticketDelete: { color: 0xed4245, heading: "🗑️ Ticket Deleted" },
	userAdded: { color: 0x3ba55c, heading: "➕ User Added" },
	userRemoved: { color: 0xed4245, heading: "➖ User Removed" },
};

const age = (createdAt: number | bigint) => msToHm(Date.now() - Number(createdAt));

function describe(event: LogEvent): string {
	const who = `${event.user.tag} (<@${event.user.id}>)`;
	switch (event.type) {
		case "ticketCreate":
			return `${who} Created a ticket (<#${event.channelId}>) with the reason: \`${event.reason?.trim() || MSG.noReasonGiven}\``;
		case "ticketClaim":
			return `${who} Claimed the ticket n°${event.ticketId} (<#${event.channelId}>) after ${age(event.createdAt)} of creation`;
		case "ticketClose":
			return `${who} Closed the ticket n°${event.ticketId} (<#${event.channelId}>) with the reason: \`${event.reason?.trim() || MSG.noReasonGiven}\` after ${age(event.createdAt)} of creation`;
		case "ticketDelete":
			return `${who} Deleted the ticket n°${event.ticketId} after ${age(event.createdAt)} of creation`;
		case "userAdded":
			return `${who} Added <@${event.targetId}> (${event.targetId}) to the ticket n°${event.ticketId} (<#${event.channelId}>)`;
		case "userRemoved":
			return `${who} Removed <@${event.targetId}> (${event.targetId}) from the ticket n°${event.ticketId} (<#${event.channelId}>)`;
	}
}

/** Log entries are Components V2, matching the rest of the bot — no legacy embeds anywhere. */
export async function logEvent(client: ExtendedClient, event: LogEvent): Promise<void> {
	if (!client.config.logs || !client.config.logsChannelId) return;

	const channel = await client.channels.fetch(client.config.logsChannelId).catch(() => null);
	if (!channel || channel.type !== ChannelType.GuildText) {
		console.error("logs: logsChannelId is not a valid text channel");
		return;
	}

	const { color, heading } = STYLE[event.type];
	const section = new SectionBuilder()
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${heading}\n${describe(event)}`))
		.setThumbnailAccessory(new ThumbnailBuilder().setURL(event.user.displayAvatarURL({ extension: "png", size: 128 })));

	const container = new ContainerBuilder().setAccentColor(color).addSectionComponents(section);

	await (channel as TextChannel)
		.send({ flags: MessageFlags.IsComponentsV2, components: [container] })
		.catch((e) => console.error("Failed to send log:", e));
}
