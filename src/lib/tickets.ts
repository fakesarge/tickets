import { GuildMember } from "discord.js";
import ExtendedClient from "../structure/ExtendedClient";
import { TicketType } from "./types";

export function isStaffFor(client: ExtendedClient, member: GuildMember | null, ticketType?: TicketType): boolean {
	if (!member) return false;
	const staffRoles = ticketType?.staffRoleIds?.length ? ticketType.staffRoleIds : client.config.rolesWithTicketAccess;
	return member.roles.cache.some((r) => staffRoles.includes(r.id));
}

export function isBlockedFromTicketType(member: GuildMember | null, ticketType: TicketType): boolean {
	if (!member) return false;
	return ticketType.cantAccessRoleIds.some((r) => member.roles.cache.has(r));
}

export function isBlacklisted(client: ExtendedClient, member: GuildMember | null): boolean {
	if (!member) return false;
	return client.config.rolesBlockedFromCreatingTickets.some((r) => member.roles.cache.has(r));
}

export function getTicketType(client: ExtendedClient, codeName: string): TicketType | undefined {
	return client.config.ticketTypes.find((t) => t.codeName === codeName);
}

export function formatTicketName(format: string, vars: { count: number; username: string; userid: string }): string {
	return format
		.replaceAll("{count}", String(vars.count))
		.replaceAll("{username}", vars.username)
		.replaceAll("{userid}", vars.userid)
		.slice(0, 90);
}

export function resolveColor(color: string | undefined, fallback: string): number {
	const raw = (color && color.trim()) || fallback;
	const cleaned = raw.replace("#", "");
	const parsed = parseInt(cleaned, 16);
	return Number.isFinite(parsed) ? parsed : 0x2ecc71;
}

/** Replaces every occurrence of each KEY in `text` with its value (e.g. USERNAME, REASON1). */
export function fillTemplate(text: string, vars: Record<string, string>): string {
	let out = text;
	for (const [key, value] of Object.entries(vars)) out = out.split(key).join(value);
	return out;
}

export function msToHm(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const d = Math.floor(total / 86400);
	const h = Math.floor((total % 86400) / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (d > 0) return `${d}d ${h}h ${m}m ${s}s`;
	if (h > 0) return `${h}h ${m}m ${s}s`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

/** With `close.onlyStaffCanClose` on, only staff may close; otherwise anyone in the ticket can. */
export function canCloseTicket(client: ExtendedClient, member: GuildMember | null, ticketType?: TicketType): boolean {
	if (!client.config.close.onlyStaffCanClose) return true;
	return isStaffFor(client, member, ticketType);
}
