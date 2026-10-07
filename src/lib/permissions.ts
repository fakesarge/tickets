import { GuildMember, PermissionFlagsBits } from "discord.js";
import ExtendedClient from "../structure/ExtendedClient";

/** Admin = Discord Administrator permission, or any role listed in config `adminRoleIds`. */
export function isAdmin(client: ExtendedClient, member: GuildMember | null): boolean {
	if (!member) return false;
	if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
	const adminRoles = client.config.adminRoleIds ?? [];
	return member.roles.cache.some((r) => adminRoles.includes(r.id));
}
