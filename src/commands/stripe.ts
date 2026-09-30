import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChatInputCommandInteraction,
	ContainerBuilder,
	MessageFlags,
	PermissionFlagsBits,
	SectionBuilder,
	SlashCommandBuilder,
	TextDisplayBuilder,
	ThumbnailBuilder,
} from "discord.js";
import BaseCommand from "../structure/BaseCommand";
import { brand } from "../ui/theme";

const STRIPE_LOGO = "https://cdn.iconscout.com/icon/free/png-512/free-stripe-logo-icon-svg-download-png-2945188.png";
const NOT_CONFIGURED = "Set `STRIPE_SECRET_KEY` in your `.env` (a read-only restricted key works) and restart the bot.";

// Balance transaction types that move money out of Stripe rather than earning it.
const NON_EARNING_TYPES = new Set(["payout", "payout_cancel", "payout_failure", "transfer", "transfer_cancel", "transfer_failure", "topup"]);

class StripeError extends Error {}

type Money = { amount: number; currency: string };
type Balance = { available: Money[]; pending: Money[] };
type Account = { id: string; email?: string | null; business_profile?: { name?: string | null }; settings?: { dashboard?: { display_name?: string | null } } };
type BalanceTransaction = { id: string; net: number; currency: string; type: string };
type TransactionList = { data: BalanceTransaction[]; has_more: boolean };

async function stripeGet<T>(path: string, params: Record<string, string> = {}): Promise<{ data: T; ms: number }> {
	const key = process.env["STRIPE_SECRET_KEY"];
	if (!key) throw new StripeError(NOT_CONFIGURED);

	const url = new URL(`https://api.stripe.com/v1/${path}`);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

	const started = Date.now();
	const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
	const ms = Date.now() - started;

	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
		throw new StripeError(body?.error?.message ?? `Stripe responded with HTTP ${res.status}.`);
	}
	return { data: (await res.json()) as T, ms };
}

function formatMoney(minorUnits: number, currency: string): string {
	const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() });
	const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
	return formatter.format(minorUnits / 10 ** digits);
}

function sum(entries: Money[], currency: string): number {
	return entries.filter((e) => e.currency === currency).reduce((total, e) => total + e.amount, 0);
}

async function netLastSevenDays(currency: string): Promise<number> {
	const since = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
	let total = 0;
	let startingAfter: string | undefined;

	for (let page = 0; page < 10; page++) {
		const { data } = await stripeGet<TransactionList>("balance_transactions", {
			"created[gte]": String(since),
			limit: "100",
			...(startingAfter ? { starting_after: startingAfter } : {}),
		});
		for (const tx of data.data) if (tx.currency === currency && !NON_EARNING_TYPES.has(tx.type)) total += tx.net;
		if (!data.has_more || data.data.length === 0) break;
		startingAfter = data.data[data.data.length - 1].id;
	}
	return total;
}

function errorContainer(message: string): ContainerBuilder {
	return new ContainerBuilder()
		.setAccentColor(0xed4245)
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# \`🔴\` Not Connected\n${message}`));
}

export default class StripeCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("stripe")
		.setDescription("Stripe system")
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.addSubcommand((sub) => sub.setName("connect").setDescription("Show API connection status"))
		.addSubcommand((sub) => sub.setName("dashboard").setDescription("Show Stripe dashboard"));

	async execute(interaction: ChatInputCommandInteraction) {
		// Financial data: only ever shown to the admin who ran the command.
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		try {
			const sub = interaction.options.getSubcommand();
			const payload = sub === "connect" ? await this.connect() : await this.dashboard();
			await interaction.editReply({ flags: MessageFlags.IsComponentsV2, ...payload });
		} catch (err) {
			const message = err instanceof StripeError ? err.message : "Something went wrong talking to Stripe.";
			if (!(err instanceof StripeError)) console.error("stripe command failed:", err);
			await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer(message)] });
		}
	}

	private async connect() {
		const { data: account, ms } = await stripeGet<Account>("account");
		const name = account.settings?.dashboard?.display_name || account.business_profile?.name || account.email || account.id;

		const section = new SectionBuilder()
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					"# `🟢` Connected Via API\n" +
						`Stripe Username: \`${name}\`\n` +
						"Stripe API Key: `***************************`\n\n" +
						`**Connection:** \`${ms}ms\``
				)
			)
			.setThumbnailAccessory(new ThumbnailBuilder().setURL(STRIPE_LOGO));

		return { components: [new ContainerBuilder().setAccentColor(0x7752ff).addSectionComponents(section)] };
	}

	private async dashboard() {
		const { data: balance } = await stripeGet<Balance>("balance");
		const currency = balance.available[0]?.currency ?? balance.pending[0]?.currency ?? "usd";

		const inAccount = sum(balance.available, currency);
		const incoming = sum(balance.pending, currency);
		const week = await netLastSevenDays(currency);

		const weekLine = `${week >= 0 ? "+" : "-"} ${formatMoney(Math.abs(week), currency)}`;

		const section = new SectionBuilder()
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					"# `💳` Dashboard\n\n" +
						`Last 7 days\n\`\`\`diff\n${weekLine}\n\`\`\`\n` +
						`**Incoming:** ${formatMoney(incoming, currency)}\n` +
						`**In Account:** ${formatMoney(inAccount, currency)}`
				)
			)
			.setThumbnailAccessory(new ThumbnailBuilder().setURL(STRIPE_LOGO));

		const { websiteUrl, supportUrl } = brand();
		const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Dashboard").setURL("https://dashboard.stripe.com"),
			new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Support").setURL(supportUrl || websiteUrl)
		);

		return { components: [new ContainerBuilder().setAccentColor(0x6d8ef5).addSectionComponents(section), buttons] };
	}
}
