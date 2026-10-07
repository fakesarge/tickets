import { ChatInputCommandInteraction, GuildMember, SlashCommandBuilder } from "discord.js";
import BaseCommand from "../structure/BaseCommand";
import { isAdmin } from "../lib/permissions";
import { VipInputError, getVip, giveVip, listActiveVips, parseExpiry, revokeVip } from "../lib/vip";
import { buildVipGrantedPayload, buildVipListPayload, buildVipStatusPayload } from "../ui/vip";
import { MSG } from "../ui/messages";

export default class VipCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("vip")
		.setDescription("VIP membership")
		.addSubcommand((s) =>
			s
				.setName("check")
				.setDescription("Check your VIP status and expiry date")
				.addUserOption((o) => o.setName("user").setDescription("Admins only: check someone else").setRequired(false))
		)
		.addSubcommand((s) =>
			s
				.setName("give")
				.setDescription("Admin: give someone VIP, or change their expiry")
				.addUserOption((o) => o.setName("user").setDescription("Who gets VIP").setRequired(true))
				.addStringOption((o) => o.setName("expires").setDescription("Expiry date (2026-12-31) or length (30d, 4w)").setRequired(true))
		)
		.addSubcommand((s) =>
			s
				.setName("revoke")
				.setDescription("Admin: remove someone's VIP")
				.addUserOption((o) => o.setName("user").setDescription("Whose VIP to remove").setRequired(true))
		)
		.addSubcommand((s) => s.setName("list").setDescription("Admin: list everyone with active VIP"));

	async execute(interaction: ChatInputCommandInteraction) {
		const sub = interaction.options.getSubcommand();
		const admin = isAdmin(this.client, interaction.member as GuildMember | null);

		if (sub !== "check" && !admin) return interaction.reply({ content: MSG.adminOnly, ephemeral: true });

		if (sub === "check") {
			const target = interaction.options.getUser("user") ?? interaction.user;
			const self = target.id === interaction.user.id;
			if (!self && !admin) return interaction.reply({ content: MSG.vipOwnOnly, ephemeral: true });
			return interaction.reply(buildVipStatusPayload(target.id, await getVip(this.client.prisma, target.id), self));
		}

		if (sub === "give") {
			const user = interaction.options.getUser("user", true);
			if (user.bot) return interaction.reply({ content: "Bots can't have VIP.", ephemeral: true });
			try {
				const expiresAt = parseExpiry(interaction.options.getString("expires", true));
				await giveVip(this.client.prisma, user.id, expiresAt, interaction.user.id);
				return interaction.reply(buildVipGrantedPayload(user.id, expiresAt));
			} catch (err) {
				if (err instanceof VipInputError) return interaction.reply({ content: err.message, ephemeral: true });
				throw err;
			}
		}

		if (sub === "revoke") {
			const user = interaction.options.getUser("user", true);
			const removed = await revokeVip(this.client.prisma, user.id);
			return interaction.reply({ content: removed ? MSG.vipRevoked(user.id) : MSG.vipNotFound(user.id), ephemeral: true });
		}

		return interaction.reply(buildVipListPayload(await listActiveVips(this.client.prisma)));
	}
}
