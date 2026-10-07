import { ChatInputCommandInteraction, GuildMember, MessageFlags, SlashCommandBuilder } from "discord.js";
import BaseCommand from "../structure/BaseCommand";
import { isAdmin } from "../lib/permissions";
import { VipInputError, parseExpiry } from "../lib/vip";
import {
	QUEUE_LEVELS,
	currentActivityLines,
	getTracked,
	loadState,
	postAnnouncement,
	refreshBoard,
	setTracked,
	updateState,
	type BoardResult,
	type QueueLevel,
} from "../lib/shopStatus";
import { QUEUE_INFO, buildStatusBoard } from "../ui/shopStatus";
import { MSG } from "../ui/messages";

const MAX_TRACKED = 10;

const saleStates = [
	{ name: "Started", value: "live" },
	{ name: "Ending soon", value: "ending" },
	{ name: "Ended", value: "off" },
];
const queueChoices = [...QUEUE_LEVELS.map((l) => ({ name: QUEUE_INFO[l].label, value: l })), { name: "Hide queue", value: "off" }];

export default class ShopCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("shop")
		.setDescription("Shop status board")
		.addSubcommand((s) => s.setName("view").setDescription("See the shop's current status"))
		.addSubcommand((s) =>
			s
				.setName("open")
				.setDescription("Admin: mark the store open")
				.addStringOption((o) => o.setName("note").setDescription("Optional line shown under the heading").setMaxLength(200))
				.addBooleanOption((o) => o.setName("ping").setDescription("Ping the status role (default: yes)"))
		)
		.addSubcommand((s) =>
			s
				.setName("close")
				.setDescription("Admin: mark the store closed for today")
				.addStringOption((o) => o.setName("reason").setDescription("Why, or when you're back").setMaxLength(200))
		)
		.addSubcommand((s) =>
			s
				.setName("queue")
				.setDescription("Admin: set how busy the order queue is")
				.addStringOption((o) => o.setName("level").setDescription("Queue level").setRequired(true).addChoices(...queueChoices))
		)
		.addSubcommand((s) =>
			s
				.setName("sale")
				.setDescription("Admin: start, end, or flag a sale as ending soon")
				.addStringOption((o) => o.setName("state").setDescription("What's happening with the sale").setRequired(true).addChoices(...saleStates))
				.addStringOption((o) => o.setName("name").setDescription("Sale name, e.g. Summer Sale").setMaxLength(60))
				.addStringOption((o) => o.setName("details").setDescription("e.g. 20% off all GFX packs").setMaxLength(300))
				.addStringOption((o) => o.setName("ends").setDescription("When it ends: a date (2026-12-31) or length (3d, 1w)").setMaxLength(20))
				.addBooleanOption((o) => o.setName("ping").setDescription("Ping the status role (default: yes)"))
		)
		.addSubcommand((s) =>
			s
				.setName("note")
				.setDescription("Admin: set (or clear) a short line on the board")
				.addStringOption((o) => o.setName("text").setDescription("Leave empty to clear it").setMaxLength(200))
		)
		.addSubcommand((s) =>
			s
				.setName("announce")
				.setDescription("Admin: post a one-off announcement in the status channel")
				.addStringOption((o) => o.setName("message").setDescription("What to announce").setRequired(true).setMaxLength(1000))
				.addBooleanOption((o) => o.setName("ping").setDescription("Ping the status role (default: yes)"))
		)
		.addSubcommand((s) =>
			s
				.setName("track")
				.setDescription("Admin: show this person's live activity (e.g. Photoshop) on the board")
				.addUserOption((o) => o.setName("user").setDescription("Who to show").setRequired(true))
		)
		.addSubcommand((s) =>
			s
				.setName("untrack")
				.setDescription("Admin: stop showing this person's activity")
				.addUserOption((o) => o.setName("user").setDescription("Who to stop showing").setRequired(true))
		)
		.addSubcommand((s) => s.setName("tracking").setDescription("Admin: see whose activity the board shows"))
		.addSubcommand((s) => s.setName("refresh").setDescription("Admin: update the board now (re-posts it if it was deleted)"));

	async execute(interaction: ChatInputCommandInteraction) {
		const sub = interaction.options.getSubcommand();
		const admin = isAdmin(this.client, interaction.member as GuildMember | null);
		if (sub !== "view" && !admin) return interaction.reply({ content: MSG.adminOnly, ephemeral: true });

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const say = (content: string) => interaction.editReply({ content });
		const channelId = this.client.config.shopStatus?.channelId;
		const where = channelId ? `<#${channelId}>` : "the status channel";

		if (sub === "view") {
			const state = await loadState(this.client);
			if (!state) return say("The shop status hasn't been set yet.");
			const payload = buildStatusBoard(this.client, state, await currentActivityLines(this.client), { ephemeral: true });
			return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: payload.components as never, files: payload.files });
		}

		if (!channelId) return say("No status channel is configured — set `shopStatus.channelId` in `config/config.jsonc`.");

		const boardNote = (r: BoardResult) =>
			r === "no-channel" ? `⚠️ I couldn't reach ${where} — check the ID and that I can view, send messages and embed there.` : `Board ${r}.`;

		if (sub === "tracking") {
			const ids = await getTracked(this.client);
			return say(ids.length ? `Showing live activity for: ${ids.map((id) => `<@${id}>`).join(", ")}` : "Nobody is tracked yet. Use `/shop track user:`.");
		}
		if (sub === "track" || sub === "untrack") {
			const user = interaction.options.getUser("user", true);
			if (user.bot) return say("Bots don't have an activity to show.");
			if (sub === "track" && !(await getTracked(this.client)).includes(user.id) && (await getTracked(this.client)).length >= MAX_TRACKED)
				return say(`You can track up to ${MAX_TRACKED} people.`);
			await setTracked(this.client, user.id, sub === "track");
			const r = await refreshBoard(this.client);
			const hint = this.client.config.shopStatus?.trackPresence === false ? "\n⚠️ `shopStatus.trackPresence` is off in the config, so nothing will show until you turn it on." : "";
			return say(
				(sub === "track" ? `✅ The board will now show what ${user} is working in (app names only — never file names).` : `✅ Stopped showing ${user}'s activity.`) +
					(r === "no-state" ? "\nSet the store status with `/shop open` or `/shop close` to publish the board." : r === "no-channel" ? `\n${boardNote(r)}` : "") +
					hint
			);
		}

		if (sub === "refresh") {
			const r = await refreshBoard(this.client, { reupload: true });
			return say(r === "no-state" ? "Set the store status first with `/shop open` or `/shop close`." : boardNote(r) + (r === "no-channel" ? "" : ` See ${where}.`));
		}

		if (sub === "announce") {
			const ok = await postAnnouncement(this.client, { type: "custom", message: interaction.options.getString("message", true).trim() }, { ping: interaction.options.getBoolean("ping") ?? true });
			return say(ok ? `✅ Announcement posted in ${where}.` : boardNote("no-channel"));
		}

		// Everything below changes the shop state, then updates the board and posts the "what changed" notice.
		const existing = await loadState(this.client);
		if (!existing && sub !== "open" && sub !== "close") return say("Set the store status first with `/shop open` or `/shop close`.");

		const ping = interaction.options.getBoolean("ping") ?? true;
		let summary: string;
		let announce: (() => Promise<boolean>) | null = null;

		if (sub === "open" || sub === "close") {
			const note = (interaction.options.getString(sub === "open" ? "note" : "reason") ?? "").trim() || undefined;
			const state = await updateState(this.client, (s) => {
				s.store = sub === "open" ? "open" : "closed";
				s.storeNote = note;
			});
			summary = sub === "open" ? "Store is now **open**." : "Store is now **closed for today**.";
			announce = () => postAnnouncement(this.client, { type: "store", state }, { ping: sub === "open" && ping });
		} else if (sub === "queue") {
			const level = interaction.options.getString("level", true) as QueueLevel | "off";
			if (existing?.queue === level) return say(`The queue is already ${level === "off" ? "hidden" : level}.`);
			await updateState(this.client, (s) => {
				s.queue = level;
			});
			summary = level === "off" ? "Queue hidden from the board." : `Queue set to **${level}**.`;
			if (level !== "off") announce = () => postAnnouncement(this.client, { type: "queue", level }, { ping: false });
		} else if (sub === "sale") {
			const next = interaction.options.getString("state", true) as "live" | "ending" | "off";
			const name = interaction.options.getString("name")?.trim() || undefined;
			const details = interaction.options.getString("details")?.trim() || undefined;
			const endsRaw = interaction.options.getString("ends")?.trim();
			let endsAt: number | undefined;
			if (endsRaw && next !== "off") {
				try {
					endsAt = parseExpiry(endsRaw);
				} catch (err) {
					if (err instanceof VipInputError) return say(err.message);
					throw err;
				}
			}
			if (next !== "off" && !existing?.sale.name && !name) return say("Give the sale a name, e.g. `name: Summer Sale`.");
			if (next === "off" && existing?.sale.state === "off") return say("There's no sale running.");

			let sale = existing?.sale;
			const state = await updateState(this.client, (s) => {
				sale = next === "off" ? { state: "off" } : { state: next, name: name ?? s.sale.name, details: details ?? s.sale.details, endsAt: endsAt ?? s.sale.endsAt };
				s.sale = sale;
			});
			summary = next === "off" ? "Sale ended." : next === "live" ? `Sale **${state.sale.name}** started.` : `Sale **${state.sale.name}** marked as ending soon.`;
			announce = () =>
				postAnnouncement(
					this.client,
					{ type: "sale", state: next, name: next === "off" ? existing?.sale.name : state.sale.name, details: state.sale.details, endsAt: state.sale.endsAt },
					{ ping: next !== "off" && ping }
				);
		} else {
			const text = (interaction.options.getString("text") ?? "").trim() || undefined;
			await updateState(this.client, (s) => {
				s.note = text;
			});
			summary = text ? "Board note updated." : "Board note cleared.";
		}

		// Board first (it's the anchor message), then the "what changed" notice underneath it.
		const board = await refreshBoard(this.client);
		const posted = announce ? await announce() : null;
		const lines = [`✅ ${summary}`];
		if (board === "no-channel") lines.push(boardNote(board));
		else lines.push(`Board ${board} in ${where}${posted ? " and an announcement was posted" : ""}.`);
		if (posted === false && board !== "no-channel") lines.push("⚠️ The announcement couldn't be posted.");
		return say(lines.join("\n"));
	}
}
