import { AutocompleteInteraction, ChatInputCommandInteraction, GuildMember, MessageFlags, SlashCommandBuilder } from "discord.js";
import BaseCommand from "../structure/BaseCommand";
import { isAdmin } from "../lib/permissions";
import { getOrdersApi } from "../lib/ordersApi";
import {
	ORDER_CATEGORIES,
	ORDER_STATUSES,
	OrderCategory,
	OrderError,
	OrderPatch,
	OrderStatus,
	STATUS_LABEL,
	createOrder,
	findOrder,
	ordersForUser,
	searchOrders,
	updateOrder,
} from "../lib/orders";
import { buildOrderDetailPayload, buildOrderListPayload } from "../ui/orders";
import { notifyOrderStatusChange } from "../lib/orderNotify";
import { MSG } from "../ui/messages";

const MAX_PRICE = 99_999_999.99;
const ADMIN_SUBCOMMANDS = new Set(["add", "edit", "status"]);

const categoryChoices = ORDER_CATEGORIES.map((c) => ({ name: c, value: c }));
const statusChoices = ORDER_STATUSES.map((s) => ({ name: STATUS_LABEL[s].label, value: s }));

export default class OrderCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("order")
		.setDescription("View your orders, or manage them if you're an admin")
		.addSubcommand((s) =>
			s
				.setName("list")
				.setDescription("List your orders and their status")
				.addUserOption((o) => o.setName("user").setDescription("Admins only: list someone else's orders").setRequired(false))
		)
		.addSubcommand((s) =>
			s
				.setName("view")
				.setDescription("See the details and status of one order")
				.addStringOption((o) => o.setName("order").setDescription("The order to look at").setRequired(true).setAutocomplete(true))
		)
		.addSubcommand((s) =>
			s
				.setName("add")
				.setDescription("Admin: create an order for a customer")
				.addUserOption((o) => o.setName("user").setDescription("The customer").setRequired(true))
				.addStringOption((o) => o.setName("name").setDescription("Order name").setRequired(true).setMaxLength(100))
				.addNumberOption((o) => o.setName("price").setDescription("Price in USD").setRequired(true).setMinValue(0.01).setMaxValue(MAX_PRICE))
				.addStringOption((o) => o.setName("category").setDescription("Defaults to gfx").addChoices(...categoryChoices))
				.addStringOption((o) => o.setName("service").setDescription("Service name (defaults to the order name)").setMaxLength(100))
				.addStringOption((o) => o.setName("description").setDescription("Details about the order").setMaxLength(1000))
		)
		.addSubcommand((s) =>
			s
				.setName("edit")
				.setDescription("Admin: change an order's name, price, or details")
				.addStringOption((o) => o.setName("order").setDescription("The order to edit").setRequired(true).setAutocomplete(true))
				.addStringOption((o) => o.setName("name").setDescription("New order name").setMaxLength(100))
				.addNumberOption((o) => o.setName("price").setDescription("New price in USD").setMinValue(0.01).setMaxValue(MAX_PRICE))
				.addStringOption((o) => o.setName("category").setDescription("New category").addChoices(...categoryChoices))
				.addStringOption((o) => o.setName("service").setDescription("New service name").setMaxLength(100))
				.addStringOption((o) => o.setName("description").setDescription("New description").setMaxLength(1000))
		)
		.addSubcommand((s) =>
			s
				.setName("status")
				.setDescription("Admin: change an order's status")
				.addStringOption((o) => o.setName("order").setDescription("The order to update").setRequired(true).setAutocomplete(true))
				.addStringOption((o) => o.setName("status").setDescription("New status").setRequired(true).addChoices(...statusChoices))
		);

	async autocomplete(interaction: AutocompleteInteraction) {
		const api = getOrdersApi();
		if (!api) return interaction.respond([]);

		const sub = interaction.options.getSubcommand();
		const admin = isAdmin(this.client, interaction.member as GuildMember | null);
		// Never suggest other people's orders to non-admins.
		if (ADMIN_SUBCOMMANDS.has(sub) && !admin) return interaction.respond([]);

		const orders = await searchOrders(api, interaction.options.getFocused(), admin ? {} : { ownerDiscordId: interaction.user.id });
		return interaction.respond(orders.map((o) => ({ name: `${o.order_code} — ${o.order_name}`.slice(0, 100), value: o.order_code })));
	}

	async execute(interaction: ChatInputCommandInteraction) {
		const api = getOrdersApi();
		if (!api) return interaction.reply({ content: MSG.ordersNotConfigured, ephemeral: true });

		const sub = interaction.options.getSubcommand();
		const admin = isAdmin(this.client, interaction.member as GuildMember | null);
		if (ADMIN_SUBCOMMANDS.has(sub) && !admin) return interaction.reply({ content: MSG.adminOnly, ephemeral: true });

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const show = (payload: { components: unknown[] }) =>
			interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: payload.components as never });

		try {
			if (sub === "list") {
				const target = interaction.options.getUser("user") ?? interaction.user;
				const self = target.id === interaction.user.id;
				if (!self && !admin) return void (await interaction.editReply({ content: MSG.orderOwnOnly }));
				const orders = await ordersForUser(api, target.id);
				return void (await show(buildOrderListPayload(orders, self ? "Your orders" : `Orders for ${target.username}`)));
			}

			if (sub === "view") {
				const order = await findOrder(api, interaction.options.getString("order", true), admin ? undefined : interaction.user.id);
				if (!order) return void (await interaction.editReply({ content: MSG.orderNotFound }));
				return void (await show(buildOrderDetailPayload(order, { admin })));
			}

			if (sub === "add") {
				const user = interaction.options.getUser("user", true);
				if (user.bot) return void (await interaction.editReply({ content: "Bots can't have orders." }));
				const order = await createOrder(api, {
					discordId: user.id,
					discordUsername: user.username,
					name: interaction.options.getString("name", true).trim(),
					price: Math.round(interaction.options.getNumber("price", true) * 100) / 100,
					category: (interaction.options.getString("category") ?? "gfx") as OrderCategory,
					service: interaction.options.getString("service"),
					description: interaction.options.getString("description"),
				});
				return void (await show(buildOrderDetailPayload(order, { admin: true, heading: "✅ Order created" })));
			}

			const code = interaction.options.getString("order", true);

			if (sub === "status") {
				const next = interaction.options.getString("status", true) as OrderStatus;
				const before = await findOrder(api, code);
				if (!before) return void (await interaction.editReply({ content: MSG.orderNotFound }));
				const previousStatus = before.status;
				if (previousStatus === next) return void (await interaction.editReply({ content: `That order is already ${STATUS_LABEL[next].label}.` }));

				const order = await updateOrder(api, code, { status: next });
				if (!order) return void (await interaction.editReply({ content: MSG.orderNotFound }));

				const dm = await notifyOrderStatusChange(this.client, order, previousStatus);
				const footnote =
					dm === "sent" ? "📨 Customer notified by DM." : dm === "failed" ? "⚠️ Couldn't DM the customer (their DMs may be closed)." : "⚠️ No Discord user is linked to this order, so nobody was notified.";
				return void (await show(buildOrderDetailPayload(order, { admin: true, heading: "🔄 Status updated", footnote })));
			}

			// edit
			const patch: OrderPatch = {};
			const name = interaction.options.getString("name");
			const price = interaction.options.getNumber("price");
			const category = interaction.options.getString("category");
			const service = interaction.options.getString("service");
			const description = interaction.options.getString("description");
			if (name) patch.order_name = name.trim();
			if (price !== null) patch.price = Math.round(price * 100) / 100;
			if (category) patch.category = category as OrderCategory;
			if (service) patch.service = service.trim();
			if (description) patch.description = description.trim();

			const order = await updateOrder(api, code, patch);
			if (!order) return void (await interaction.editReply({ content: MSG.orderNotFound }));
			return void (await show(buildOrderDetailPayload(order, { admin: true, heading: "✏️ Order updated" })));
		} catch (err) {
			if (err instanceof OrderError) return void (await interaction.editReply({ content: err.message }));
			console.error(`/order ${sub} failed:`, err);
			return void (await interaction.editReply({ content: MSG.ordersLookupFailed }));
		}
	}
}
