import type { Presence } from "discord.js";
import BaseEvent from "../structure/BaseEvent";
import { getTracked, scheduleBoardRefresh } from "../lib/shopStatus";

/** When a tracked member's activity changes (opens Photoshop, changes their custom status, …), refresh the status board. */
export default class PresenceUpdateEvent extends BaseEvent {
	public async execute(_old: Presence | null, next: Presence): Promise<void> {
		if (!this.client.config.shopStatus?.channelId || this.client.config.shopStatus.trackPresence === false) return;
		if (next.guild?.id !== this.client.config.guildId) return;
		if (!(await getTracked(this.client)).includes(next.userId)) return;
		scheduleBoardRefresh(this.client);
	}
}
