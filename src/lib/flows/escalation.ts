import { TextChannel } from "discord.js";
import ExtendedClient from "../../structure/ExtendedClient";
import { TicketType } from "../types";
import { buildEscalationPayload, SummaryEntry } from "./render";
import { FlowState } from "./types";

export function buildSummaryEntries(state: FlowState): SummaryEntry[] {
	const entries: SummaryEntry[] = [];
	for (const [question, answer] of Object.entries(state.selections)) entries.push({ label: question, value: answer });
	for (const [label, answer] of Object.entries(state.responses)) {
		if (!answer) continue;
		entries.push({ label, value: answer });
	}
	return entries;
}

function staffRoleIds(client: ExtendedClient, ticketType: TicketType): string[] {
	if (ticketType.staffRoleIds.length > 0) return ticketType.staffRoleIds;
	if (client.config.pingRolesOnOpen.length) return client.config.pingRolesOnOpen;
	return client.config.rolesWithTicketAccess;
}

/** Lets the ticket creator (and anyone invited) type again — called once a human takes over. */
export async function unlockTicketChat(client: ExtendedClient, channel: TextChannel): Promise<void> {
	const ticket = await client.prisma.tickets.findUnique({ where: { channelId: channel.id }, select: { creator: true, invited: true } });
	if (!ticket) return;

	const userIds = [ticket.creator, ...(JSON.parse(ticket.invited || "[]") as string[])];
	for (const userId of userIds) {
		await channel.permissionOverwrites.edit(userId, { SendMessages: true, AttachFiles: true }).catch((e) => console.error(e));
	}
}

/**
 * Marks the ticket escalated and turns the ticket's guided-flow message into the single
 * hand-off-to-staff message (role ping + summary), in place — no extra messages are sent.
 * Idempotent: calling it twice does not double-notify.
 */
export async function escalateTicket(client: ExtendedClient, channel: TextChannel, ticketType: TicketType, state: FlowState): Promise<void> {
	if (state.escalated) return;
	state.escalated = true;

	await unlockTicketChat(client, channel);

	const entries = buildSummaryEntries(state);
	const roleIds = staffRoleIds(client, ticketType);
	const pingContent = roleIds.length > 0 ? roleIds.map((r) => `<@&${r}>`).join(" ") : "";
	const payload = buildEscalationPayload(pingContent, entries);

	const ticket = await client.prisma.tickets.findUnique({ where: { channelId: channel.id }, select: { flowMessageId: true } });
	const msg = ticket?.flowMessageId ? await channel.messages.fetch(ticket.flowMessageId).catch(() => null) : null;

	if (msg) await msg.edit(payload).catch((e) => console.error(e));
	else await channel.send(payload).catch((e) => console.error(e));
}
