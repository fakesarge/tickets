import { ActivityType, ChannelType, TextChannel } from "discord.js";
import BaseEvent from "../structure/BaseEvent";
import { buildTicketPanel } from "../ui/panel";
import { startVipReminders } from "../lib/vip";
import { startShopStatus } from "../lib/shopStatus";

const ACTIVITY_TYPES: Record<string, ActivityType> = {
	PLAYING: ActivityType.Playing,
	LISTENING: ActivityType.Listening,
	WATCHING: ActivityType.Watching,
	COMPETING: ActivityType.Competing,
};

export default class ReadyEvent extends BaseEvent {
	public async execute(): Promise<void> {
		console.log(`Logged in as ${this.client.user?.tag}`);

		await this.client.deployCommands();
		await this.validateGuildResources();

		await this.postOrUpdatePanel();
		this.setPresence();
		startVipReminders(this.client);
		startShopStatus(this.client);
	}

	/** Checks that every guild-scoped ID in config.jsonc actually resolves, so a typo'd category or
	 *  role shows up as one clear warning at startup instead of a confusing failure deep in a ticket flow. */
	private async validateGuildResources(): Promise<void> {
		const { config } = this.client;
		const guild = await this.client.guilds.fetch(config.guildId).catch(() => null);
		if (!guild) {
			console.error(`config.jsonc: guildId ${config.guildId} — bot is not in this guild, or the ID is wrong.`);
			return;
		}

		const [channels, roles] = await Promise.all([guild.channels.fetch(), guild.roles.fetch()]);
		const missing: string[] = [];

		const checkChannel = (id: string | undefined, label: string) => {
			if (id && !channels.has(id)) missing.push(`${label} (${id}) — no channel with this ID in the guild`);
		};
		const checkRole = (id: string | undefined, label: string) => {
			if (id && !roles.has(id)) missing.push(`${label} (${id}) — no role with this ID in the guild`);
		};

		checkChannel(config.openTicketChannelId, "openTicketChannelId");
		if (config.logs) checkChannel(config.logsChannelId, "logsChannelId");
		for (const roleId of config.rolesWithTicketAccess) checkRole(roleId, "rolesWithTicketAccess");
		for (const roleId of config.pingRolesOnOpen) checkRole(roleId, "pingRolesOnOpen");

		for (const t of config.ticketTypes) {
			checkChannel(t.categoryId, `ticketTypes[${t.codeName}].categoryId`);
			for (const roleId of t.staffRoleIds) checkRole(roleId, `ticketTypes[${t.codeName}].staffRoleIds`);
			for (const roleId of t.cantAccessRoleIds) checkRole(roleId, `ticketTypes[${t.codeName}].cantAccessRoleIds`);
		}

		if (missing.length > 0) {
			console.error(`config.jsonc: ${missing.length} ID(s) don't resolve in guild "${guild.name}":\n  - ${missing.join("\n  - ")}`);
		}
	}

	private setPresence(): void {
		const { presence } = this.client.config;
		if (!presence.enabled) return;
		this.client.user?.setPresence({
			status: presence.status,
			activities: [{ name: presence.activityText, type: ACTIVITY_TYPES[presence.activityType] ?? ActivityType.Watching }],
		});
	}

	private async postOrUpdatePanel(): Promise<void> {
		const { openTicketChannelId } = this.client.config;
		if (!openTicketChannelId) {
			console.warn("config.jsonc: openTicketChannelId is not set — skipping ticket panel.");
			return;
		}

		const channel = await this.client.channels.fetch(openTicketChannelId).catch(() => null);
		if (!channel || channel.type !== ChannelType.GuildText) {
			console.error("config.jsonc: openTicketChannelId does not point to a valid text channel.");
			return;
		}

		const stored = await this.client.prisma.config.findUnique({ where: { key: "panelMessageId" } });
		const payload = buildTicketPanel(this.client);

		const existing = stored?.value ? await (channel as TextChannel).messages.fetch(stored.value).catch(() => null) : null;
		if (existing) {
			await existing
				.edit({ components: payload.components, flags: payload.flags as number, files: payload.files, attachments: [] })
				.catch((e) => console.error("Failed to update ticket panel:", e));
			return;
		}

		const sent = await (channel as TextChannel).send(payload).catch((e) => {
			console.error("Failed to post ticket panel:", e);
			return null;
		});
		if (!sent) return;

		await this.client.prisma.config.upsert({
			where: { key: "panelMessageId" },
			create: { key: "panelMessageId", value: sent.id },
			update: { value: sent.id },
		});
	}
}
