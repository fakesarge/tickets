import {
	AttachmentBuilder,
	AutocompleteInteraction,
	ChatInputCommandInteraction,
	GuildMember,
	MessageFlags,
	SlashCommandBooleanOption,
	SlashCommandBuilder,
} from "discord.js";
import BaseCommand from "../structure/BaseCommand";
import { isAdmin } from "../lib/permissions";
import {
	AffiliateError,
	AffiliateRecord,
	BalanceAction,
	WithdrawalRecord,
	adjustBalance,
	affiliateSettings,
	changeCode,
	createAffiliate,
	dollarsToCents,
	earnedRank,
	exportCsvFiles,
	formatMoney,
	getAffiliate,
	listAffiliates,
	listLedger,
	listReferrals,
	listWithdrawals,
	normalizeCode,
	referralCount,
	removeAffiliate,
	requestWithdrawal,
	suggestCode,
} from "../lib/affiliate";
import { dmUser, postPayoutRequest, settleWithdrawal } from "../lib/affiliatePayouts";
import {
	Panel,
	buildAdminViewPayload,
	buildAffiliateCreatedPayload,
	buildAffiliateListPayload,
	buildAffiliateRemovedPayload,
	buildBalanceChangedPayload,
	buildBalanceDm,
	buildCodeChangedPayload,
	buildDashboardPayload,
	buildHistoryPayload,
	buildPayoutListPayload,
	buildSharePayload,
	buildWithdrawalRequestedPayload,
	personOf,
} from "../ui/affiliate";
import { MSG } from "../ui/messages";

const MAX_AMOUNT_USD = 1_000_000;
/** Lets Excel open the CSVs as UTF-8 instead of guessing an ANSI code page. */
const UTF8_BOM = String.fromCharCode(0xfeff);

const privateOption = (o: SlashCommandBooleanOption) => o.setName("private").setDescription("Only show it to you (default: everyone can see)");

const actionChoices: { name: string; value: BalanceAction }[] = [
	{ name: "Add earnings", value: "add" },
	{ name: "Remove (clawback)", value: "remove" },
	{ name: "Set balance to exactly", value: "set" },
];

export default class AffiliateCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("affiliate")
		.setDescription("Affiliate program: your code, stats and withdrawals")
		.addSubcommand((s) => s.setName("me").setDescription("Show off your creator code and numbers").addBooleanOption(privateOption))
		.addSubcommand((s) => s.setName("stats").setDescription("Detailed stats: referrals, earnings, rank and recent activity").addBooleanOption(privateOption))
		.addSubcommand((s) => s.setName("share").setDescription("Post your creator code for everyone, with a button to use it"))
		.addSubcommand((s) =>
			s
				.setName("withdraw")
				.setDescription("Request a payout of your balance")
				.addStringOption((o) => o.setName("payout").setDescription("How we should pay you (PayPal email, etc.)").setRequired(true).setMaxLength(200))
				.addNumberOption((o) => o.setName("amount").setDescription("Amount in USD (leave empty to withdraw everything)").setMinValue(0.01).setMaxValue(MAX_AMOUNT_USD))
		)
		.addSubcommand((s) => s.setName("history").setDescription("Your balance activity and withdrawals").addBooleanOption(privateOption))
		.addSubcommandGroup((g) =>
			g
				.setName("admin")
				.setDescription("Admin: manage affiliates")
				.addSubcommand((s) =>
					s
						.setName("create")
						.setDescription("Make someone an affiliate")
						.addUserOption((o) => o.setName("user").setDescription("The new affiliate").setRequired(true))
						.addStringOption((o) => o.setName("code").setDescription("Their code (defaults to their username)").setMinLength(3).setMaxLength(20))
				)
				.addSubcommand((s) =>
					s
						.setName("remove")
						.setDescription("Remove an affiliate")
						.addUserOption((o) => o.setName("user").setDescription("The affiliate to remove").setRequired(true))
				)
				.addSubcommand((s) =>
					s
						.setName("setcode")
						.setDescription("Change an affiliate's code")
						.addUserOption((o) => o.setName("user").setDescription("The affiliate").setRequired(true))
						.addStringOption((o) => o.setName("code").setDescription("Their new code").setRequired(true).setMinLength(3).setMaxLength(20))
				)
				.addSubcommand((s) =>
					s
						.setName("balance")
						.setDescription("Add earnings, deduct, or set an affiliate's balance")
						.addUserOption((o) => o.setName("user").setDescription("The affiliate").setRequired(true))
						.addStringOption((o) => o.setName("action").setDescription("What to do").setRequired(true).addChoices(...actionChoices))
						.addNumberOption((o) => o.setName("amount").setDescription("Amount in USD").setRequired(true).setMinValue(0).setMaxValue(MAX_AMOUNT_USD))
						.addStringOption((o) => o.setName("note").setDescription("Why (shown to them and kept in their history)").setMaxLength(200))
				)
				.addSubcommand((s) =>
					s
						.setName("view")
						.setDescription("Everything about one affiliate")
						.addUserOption((o) => o.setName("user").setDescription("The affiliate").setRequired(true))
				)
				.addSubcommand((s) => s.setName("list").setDescription("All affiliates, top earners first"))
				.addSubcommand((s) => s.setName("payouts").setDescription("Withdrawals waiting for approval"))
				.addSubcommand((s) =>
					s
						.setName("approve")
						.setDescription("Mark a withdrawal as paid")
						.addIntegerOption((o) => o.setName("id").setDescription("Withdrawal number").setRequired(true).setMinValue(1).setAutocomplete(true))
						.addStringOption((o) => o.setName("note").setDescription("Optional note (e.g. a transaction ID)").setMaxLength(200))
				)
				.addSubcommand((s) =>
					s
						.setName("reject")
						.setDescription("Reject a withdrawal and refund the balance")
						.addIntegerOption((o) => o.setName("id").setDescription("Withdrawal number").setRequired(true).setMinValue(1).setAutocomplete(true))
						.addStringOption((o) => o.setName("reason").setDescription("Why it was rejected (shown to them)").setMaxLength(200))
				)
				.addSubcommand((s) => s.setName("export").setDescription("Download all affiliate data as CSV files"))
		);

	async autocomplete(interaction: AutocompleteInteraction) {
		if (!isAdmin(this.client, interaction.member as GuildMember | null)) return interaction.respond([]);
		const typed = String(interaction.options.getFocused());
		const pending = await listWithdrawals(this.client.prisma, { status: "pending", limit: 25 });
		return interaction.respond(
			pending
				.filter((w) => String(w.id).startsWith(typed))
				.map((w) => ({ name: `#${w.id} · ${formatMoney(w.amountCents)} · ${this.client.users.cache.get(w.affiliateId)?.username ?? w.affiliateId}`.slice(0, 100), value: w.id }))
		);
	}

	async execute(interaction: ChatInputCommandInteraction) {
		const group = interaction.options.getSubcommandGroup(false);
		const sub = interaction.options.getSubcommand();
		const member = interaction.member as GuildMember | null;

		const show = (panel: Panel) =>
			interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: panel.components as never, allowedMentions: { parse: [] } });

		// Admin tools stay private: they show payout details and staff-only data.
		if (group === "admin") {
			if (!isAdmin(this.client, member)) return interaction.reply({ content: MSG.adminOnly, flags: MessageFlags.Ephemeral });
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			try {
				return void (await this.runAdmin(interaction, sub, show));
			} catch (err) {
				return void (await this.fail(interaction, true, err, `admin ${sub}`));
			}
		}

		// Everything an affiliate does is public by default so they can show it off. Only errors stay private.
		const me = await this.requireAffiliate(interaction);
		if (!me) return interaction.reply({ content: MSG.affiliateOnly, flags: MessageFlags.Ephemeral });
		if (sub === "withdraw") return this.withdraw(interaction, me);

		const hidden = interaction.options.getBoolean("private") ?? false;
		await interaction.deferReply(hidden ? { flags: MessageFlags.Ephemeral } : {});
		try {
			return void (await this.runAffiliate(interaction, sub, me, hidden, show));
		} catch (err) {
			return void (await this.fail(interaction, hidden, err, sub));
		}
	}

	/** Shows an error only to the person who ran the command, even if the reply was already deferred publicly. */
	private async fail(interaction: ChatInputCommandInteraction, alreadyPrivate: boolean, err: unknown, label: string): Promise<void> {
		const content = err instanceof AffiliateError ? err.message : MSG.commandError;
		if (!(err instanceof AffiliateError)) console.error(`/affiliate ${label} failed:`, err);
		if (alreadyPrivate) {
			await interaction.editReply({ content }).catch(() => null);
			return;
		}
		await interaction.deleteReply().catch(() => null);
		await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
	}

	/**
	 * Public flex of a withdrawal request — without the payout details, which only staff see in the payout channel.
	 * The request is made before replying so a rejected one (too low, already pending, …) can be answered privately.
	 */
	private async withdraw(interaction: ChatInputCommandInteraction, me: AffiliateRecord) {
		let withdrawal: WithdrawalRecord;
		try {
			const requested = interaction.options.getNumber("amount");
			const payout = interaction.options.getString("payout", true).trim();
			if (!payout) throw new AffiliateError("Tell us how to pay you in the `payout` option.");
			const { minWithdrawalCents } = affiliateSettings(this.client);
			withdrawal = await requestWithdrawal(this.client.prisma, me.discordId, requested === null ? null : dollarsToCents(requested), payout, minWithdrawalCents);
		} catch (err) {
			if (!(err instanceof AffiliateError)) console.error("/affiliate withdraw failed:", err);
			return interaction.reply({ content: err instanceof AffiliateError ? err.message : MSG.commandError, flags: MessageFlags.Ephemeral });
		}

		await interaction.deferReply();
		const notified = await postPayoutRequest(this.client, withdrawal);
		return interaction.editReply({
			flags: MessageFlags.IsComponentsV2,
			components: buildWithdrawalRequestedPayload(withdrawal, notified).components as never,
			allowedMentions: { parse: [] },
		});
	}

	/** An affiliate is someone with a record — and, when a role is configured, that role too. */
	private async requireAffiliate(interaction: ChatInputCommandInteraction): Promise<AffiliateRecord | null> {
		const record = await getAffiliate(this.client.prisma, interaction.user.id);
		if (!record) return null;
		const { roleId } = affiliateSettings(this.client);
		if (roleId && !(interaction.member as GuildMember | null)?.roles.cache.has(roleId)) return null;
		return record;
	}

	private async runAffiliate(interaction: ChatInputCommandInteraction, sub: string, me: AffiliateRecord, hidden: boolean, show: (p: Panel) => unknown) {
		const { prisma } = this.client;
		const { minWithdrawalCents } = affiliateSettings(this.client);
		const person = personOf(interaction.user);
		const button = !hidden;

		if (sub === "share") return show(buildSharePayload(person, me, await referralCount(prisma, me.discordId)));

		const pending = (await listWithdrawals(prisma, { affiliateId: me.discordId, status: "pending", limit: 1 }))[0] ?? null;

		if (sub === "me") {
			return show(buildDashboardPayload(person, me, { referrals: await referralCount(prisma, me.discordId), minCents: minWithdrawalCents, pending, button }));
		}

		if (sub === "stats") {
			const [referrals, rank, affiliates, recent] = await Promise.all([
				referralCount(prisma, me.discordId),
				earnedRank(prisma, me.earnedCents),
				prisma.affiliates.count(),
				listLedger(prisma, me.discordId, 5),
			]);
			return show(buildDashboardPayload(person, me, { referrals, minCents: minWithdrawalCents, pending, rank, affiliateCount: affiliates, recent, button }));
		}

		// history
		const [ledger, withdrawals] = await Promise.all([listLedger(prisma, me.discordId, 8), listWithdrawals(prisma, { affiliateId: me.discordId, limit: 5 })]);
		return show(buildHistoryPayload(me.discordId, ledger, withdrawals));
	}

	private async runAdmin(interaction: ChatInputCommandInteraction, sub: string, show: (p: Panel) => unknown) {
		const { prisma } = this.client;
		const actor = interaction.user.id;
		const { roleId } = affiliateSettings(this.client);

		if (sub === "list") return show(buildAffiliateListPayload(await listAffiliates(prisma)));
		if (sub === "payouts") return show(buildPayoutListPayload(await listWithdrawals(prisma, { status: "pending", limit: 15 })));

		if (sub === "export") {
			const files = (await exportCsvFiles(prisma)).map((f) => new AttachmentBuilder(Buffer.from(UTF8_BOM + f.content, "utf8"), { name: f.name }));
			return interaction.editReply({ content: "📄 Affiliate data — open these in Excel or Google Sheets. Contains payout details, so keep it private.", files });
		}

		if (sub === "approve" || sub === "reject") {
			const id = interaction.options.getInteger("id", true);
			const note = interaction.options.getString(sub === "approve" ? "note" : "reason");
			const { withdrawal, dmSent } = await settleWithdrawal(this.client, id, sub === "approve" ? "paid" : "rejected", actor, note);
			const done = sub === "approve" ? `✅ Withdrawal **#${id}** marked as paid (${formatMoney(withdrawal.amountCents)} to <@${withdrawal.affiliateId}>).` : `❌ Withdrawal **#${id}** rejected — ${formatMoney(withdrawal.amountCents)} refunded to <@${withdrawal.affiliateId}>.`;
			return interaction.editReply({ content: `${done}\n${dmSent ? "📨 They've been notified by DM." : "⚠️ Couldn't DM them (their DMs may be closed)."}`, allowedMentions: { parse: [] } });
		}

		const user = interaction.options.getUser("user", true);
		if (user.bot) throw new AffiliateError("Bots can't be affiliates.");
		const guildMember = async () => interaction.guild?.members.fetch(user.id).catch(() => null);

		if (sub === "create") {
			const given = interaction.options.getString("code");
			const code = given ? normalizeCode(given) : await suggestCode(prisma, user.username);
			const affiliate = await createAffiliate(prisma, user.id, code, actor);

			let roleNote = "No affiliate role is configured yet (set `affiliate.roleId` in config.jsonc).";
			if (roleId) {
				const target = await guildMember();
				if (!target) roleNote = "They aren't in this server, so no role was given.";
				else roleNote = (await target.roles.add(roleId, "Affiliate created").then(() => true, () => false)) ? `Gave them <@&${roleId}>.` : "⚠️ Couldn't give the affiliate role — check the bot's role position and Manage Roles permission.";
			}
			return show(buildAffiliateCreatedPayload(personOf(user), affiliate, roleNote));
		}

		if (sub === "remove") {
			const removed = await removeAffiliate(prisma, user.id);
			if (!removed) throw new AffiliateError("That member isn't an affiliate.");

			let roleNote = "No affiliate role is configured.";
			if (roleId) {
				const target = await guildMember();
				roleNote = !target ? "They aren't in this server, so there was no role to remove." : (await target.roles.remove(roleId, "Affiliate removed").then(() => true, () => false)) ? `Removed <@&${roleId}>.` : "⚠️ Couldn't remove the affiliate role — check the bot's role position.";
			}
			return show(buildAffiliateRemovedPayload(removed, roleNote));
		}

		if (sub === "setcode") {
			const before = await getAffiliate(prisma, user.id);
			if (!before) throw new AffiliateError("That member isn't an affiliate.");
			return show(buildCodeChangedPayload(await changeCode(prisma, user.id, normalizeCode(interaction.options.getString("code", true))), before.code));
		}

		if (sub === "balance") {
			const action = interaction.options.getString("action", true) as BalanceAction;
			const note = interaction.options.getString("note");
			const { affiliate, delta } = await adjustBalance(prisma, user.id, action, dollarsToCents(interaction.options.getNumber("amount", true)), actor, note);
			if (delta !== 0) void dmUser(this.client, user.id, buildBalanceDm(affiliate, action, delta, note));
			return show(buildBalanceChangedPayload(affiliate, action, delta, note));
		}

		// view
		const affiliate = await getAffiliate(prisma, user.id);
		if (!affiliate) throw new AffiliateError("That member isn't an affiliate.");
		const [referrals, recentReferrals, ledger, withdrawals, rank] = await Promise.all([
			referralCount(prisma, user.id),
			listReferrals(prisma, user.id, 10),
			listLedger(prisma, user.id, 6),
			listWithdrawals(prisma, { affiliateId: user.id, limit: 5 }),
			earnedRank(prisma, affiliate.earnedCents),
		]);
		return show(buildAdminViewPayload(personOf(user), affiliate, { referrals, recentReferrals, ledger, withdrawals, rank }));
	}
}
