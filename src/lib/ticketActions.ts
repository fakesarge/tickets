import { BaseInteraction, ButtonInteraction, ChannelType, ChatInputCommandInteraction, GuildMember, ModalSubmitInteraction, PermissionFlagsBits, TextChannel, User } from "discord.js";
import ExtendedClient from "../structure/ExtendedClient";
import { TicketType } from "./types";
import { formatTicketName, getTicketType, isBlockedFromTicketType } from "./tickets";
import { buildTicketPanelPayload, markClaimedOnMessage } from "../ui/ticketPanel";
import { buildChannelCloseNotice, buildDmCloseNotice } from "../ui/closeNotice";
import { MSG } from "../ui/messages";
import { logEvent } from "./logs";
import { postTranscript } from "./transcripts";
import { hasFlow, markStaffTakeover, startFlow } from "./flows/engine";

const pendingCreations = new Set<string>();

function staffRolesFor(client: ExtendedClient, ticketType: TicketType, guild: { roles: { cache: { has(id: string): boolean } } }): string[] {
	const ids = [...new Set([...client.config.rolesWithTicketAccess, ...ticketType.staffRoleIds])];
	return ids.filter((id) => {
		const exists = guild.roles.cache.has(id);
		if (!exists) console.warn(`Skipping unresolvable staff role ID in permission overwrites: ${id}`);
		return exists;
	});
}

/**
 * Creates the ticket channel and its single welcome-panel message. That message is later edited
 * in place into the terms prompt, then the signed confirmation (see lib/terms.ts) — there's no
 * separate "ticket opened" display. The ticketCreate log entry fires once terms are signed, with
 * the customer's actual answers (see handleTosIntake), not here.
 */
export async function createTicket(
	client: ExtendedClient,
	guildId: string,
	creator: User,
	member: GuildMember | null,
	ticketType: TicketType
): Promise<{ ok: true; channelId: string } | { ok: false; message: string }> {
	if (pendingCreations.has(creator.id)) return { ok: false, message: MSG.alreadyCreating };
	if (isBlockedFromTicketType(member, ticketType)) return { ok: false, message: MSG.typeBlockedForRoles };

	if (client.config.maxOpenTicketsPerUser > 0) {
		const open = await client.prisma.tickets.count({ where: { creator: creator.id, closedAt: null } });
		if (open >= client.config.maxOpenTicketsPerUser) return { ok: false, message: MSG.ticketLimit(client.config.maxOpenTicketsPerUser) };
	}

	if (!ticketType.categoryId) return { ok: false, message: MSG.noCategory(ticketType.name) };

	pendingCreations.add(creator.id);
	try {
		const guild = await client.guilds.fetch(guildId);
		const nextId = ((await client.prisma.tickets.aggregate({ _max: { id: true } }))._max.id ?? 0) + 1;
		const name = formatTicketName(ticketType.ticketNameFormat, { count: nextId, username: creator.username, userid: creator.id });

		// Ticket types with a guided flow keep the customer's chat locked to buttons/menus until the flow
		// escalates to staff or a staff member claims the ticket (see src/lib/flows/escalation.ts).
		const usesFlow = hasFlow(ticketType.codeName);

		const channel = await guild.channels.create({
			name,
			type: ChannelType.GuildText,
			parent: ticketType.categoryId,
			permissionOverwrites: [
				{ id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
				{
					id: creator.id,
					allow: [
						PermissionFlagsBits.ViewChannel,
						PermissionFlagsBits.ReadMessageHistory,
						PermissionFlagsBits.AddReactions,
						...(usesFlow ? [] : [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles]),
					],
					deny: usesFlow ? [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] : [],
				},
				// Staff can always see, message in, and manage the ticket — regardless of whether the
				// ticket type locks the customer to buttons/menus.
				...staffRolesFor(client, ticketType, guild).map((roleId) => ({
					id: roleId,
					allow: [
						PermissionFlagsBits.ViewChannel,
						PermissionFlagsBits.SendMessages,
						PermissionFlagsBits.ReadMessageHistory,
						PermissionFlagsBits.AttachFiles,
						PermissionFlagsBits.AddReactions,
						PermissionFlagsBits.ManageMessages,
					],
				})),
			],
		});

		const created = await client.prisma.tickets.create({
			data: {
				channelId: channel.id,
				messageId: "pending",
				typeCodeName: ticketType.codeName,
				creator: creator.id,
				reason: "Awaiting completion of terms of service.",
				createdAt: Date.now(),
			},
		});

		const msg = await channel.send(buildTicketPanelPayload(client, creator.id));
		// The panel doubles as the terms message — "Continue" reveals the prompt in this same message.
		await client.prisma.tickets.update({ where: { id: created.id }, data: { messageId: msg.id, termsMessageId: msg.id } });
		await msg.pin().catch(() => null);

		if (usesFlow) await startFlow(client, channel, created.id, ticketType).catch((e) => console.error(e));

		return { ok: true, channelId: channel.id };
	} finally {
		pendingCreations.delete(creator.id);
	}
}

export async function claimTicket(client: ExtendedClient, channel: TextChannel, staffMember: User): Promise<{ ok: true } | { ok: false; message: string }> {
	if (!client.config.claim.enabled) return { ok: false, message: MSG.claimDisabled };

	const ticket = await client.prisma.tickets.findUnique({ where: { channelId: channel.id } });
	if (!ticket) return { ok: false, message: MSG.ticketNotFound };
	if (ticket.claimedBy) return { ok: false, message: MSG.alreadyClaimed };

	await client.prisma.tickets.update({
		where: { channelId: channel.id },
		data: { claimedBy: staffMember.id, claimedAt: Date.now() },
	});

	await logEvent(client, { type: "ticketClaim", user: staffMember, channelId: channel.id, ticketId: ticket.id, createdAt: ticket.createdAt });

	await markStaffTakeover(client, channel, staffMember.id).catch((e) => console.error(e));

	// Appends "Claimed By" and disables the Claim button on whatever the panel currently shows
	// (welcome panel, terms prompt, or signed confirmation) without touching the rest of it.
	const mainMessage = await channel.messages.fetch(ticket.messageId).catch(() => null);
	if (mainMessage) await markClaimedOnMessage(mainMessage, staffMember.id);

	const creatorUser = await client.users.fetch(ticket.creator).catch(() => null);

	if (client.config.claim.renameOnClaim?.trim()) {
		const newName = client.config.claim.renameOnClaim
			.replaceAll("{staffusername}", staffMember.username)
			.replaceAll("{creatorusername}", creatorUser?.username ?? "")
			.replaceAll("{count}", String(ticket.id));
		await channel.setName(newName.slice(0, 90)).catch(() => null);
	}

	if (client.config.claim.moveToCategoryId?.trim()) {
		const permissions = channel.permissionOverwrites.cache;
		await channel.setParent(client.config.claim.moveToCategoryId, { lockPermissions: false }).catch(() => null);
		await channel.permissionOverwrites.set(permissions.map((o) => o)).catch(() => null);
	}

	return { ok: true };
}

export async function closeTicket(
	client: ExtendedClient,
	channel: TextChannel,
	closedBy: User,
	reason: string
): Promise<{ ok: true } | { ok: false; message: string }> {
	const ticket = await client.prisma.tickets.findUnique({ where: { channelId: channel.id } });
	if (!ticket) return { ok: false, message: MSG.ticketNotFound };
	if (ticket.closedAt) return { ok: false, message: MSG.alreadyClosed };

	await client.prisma.tickets.update({
		where: { channelId: channel.id },
		data: { closedBy: closedBy.id, closedAt: Date.now(), closeReason: reason },
	});

	await logEvent(client, {
		type: "ticketClose",
		user: closedBy,
		channelId: channel.id,
		ticketId: ticket.id,
		createdAt: ticket.createdAt,
		reason,
	});

	await channel.permissionOverwrites.edit(ticket.creator, { ViewChannel: false }).catch(() => null);
	for (const userId of JSON.parse(ticket.invited) as string[]) {
		await channel.permissionOverwrites.edit(userId, { ViewChannel: false }).catch(() => null);
	}

	await postTranscript(client, channel, ticket.id);

	if (client.config.close.moveToCategoryId?.trim()) {
		await channel.setParent(client.config.close.moveToCategoryId, { lockPermissions: false }).catch((e) => console.error(e));
	}

	// The welcome panel / terms / signed message is left exactly as it was — there's no close
	// button on it to disable, and nothing else about it needs to change.
	const autoDelete = client.config.close.deleteAfterCloseSeconds;
	await channel.send(buildChannelCloseNotice(client, closedBy.id, reason, autoDelete > 0)).catch((e) => console.error(e));

	if (autoDelete > 0) {
		await logEvent(client, { type: "ticketDelete", user: closedBy, ticketId: ticket.id, createdAt: ticket.createdAt });
		await channel.send({ content: MSG.deleteInfo(autoDelete) }).catch(() => null);
		setTimeout(() => channel.delete().catch((e) => console.error(e)), autoDelete * 1000);
	}

	if (client.config.close.dmUserOnClose) {
		const creatorUser = await client.users.fetch(ticket.creator).catch(() => null);
		await creatorUser?.send(buildDmCloseNotice(client, ticket.id, reason)).catch(() => null);
	}

	return { ok: true };
}

/** Closes the ticket and finishes an already-deferred interaction with the outcome. */
export async function closeAndReply(
	interaction: ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction,
	client: ExtendedClient,
	channel: TextChannel,
	reason: string
): Promise<void> {
	const transcripts = client.config.close.createTranscript;
	if (transcripts) await interaction.editReply({ content: MSG.creatingTranscript }).catch(() => null);

	const result = await closeTicket(client, channel, interaction.user, reason);
	const content = !result.ok ? result.message : transcripts ? MSG.transcriptCreated(client.config.logsChannelId || undefined) : "> Ticket closed.";
	await interaction.editReply({ content }).catch(() => null);
}

export async function deleteTicketChannel(client: ExtendedClient, channel: TextChannel, deletedBy: User): Promise<void> {
	const ticket = await client.prisma.tickets.findUnique({ where: { channelId: channel.id } });
	if (ticket) await logEvent(client, { type: "ticketDelete", user: deletedBy, ticketId: ticket.id, createdAt: ticket.createdAt });
	await channel.delete().catch(() => null);
}

export function isTicketChannel(interaction: BaseInteraction): interaction is BaseInteraction & { channel: TextChannel } {
	return interaction.channel?.type === ChannelType.GuildText;
}
