import { OrderError, OrdersApi } from "./ordersApi";

export { OrderError } from "./ordersApi";

/** The live `orders` table enforces exactly these values with CHECK constraints. */
export const ORDER_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_CATEGORIES = ["gfx", "vfx", "template"] as const;
export type OrderCategory = (typeof ORDER_CATEGORIES)[number];

export const STATUS_LABEL: Record<OrderStatus, { label: string; emoji: string; color: number }> = {
	pending: { label: "Pending", emoji: "🕒", color: 0xfaa61a },
	in_progress: { label: "In Progress", emoji: "🛠️", color: 0x5865f2 },
	completed: { label: "Completed", emoji: "✅", color: 0x3ba55c },
	cancelled: { label: "Cancelled", emoji: "❌", color: 0xed4245 },
};

export type Order = {
	order_code: string;
	order_name: string;
	customer_name: string;
	service: string;
	category: string;
	price: number | string;
	description: string | null;
	status: string;
	discord_id: string | null;
	created_at: string;
	updated_at: string;
};

export function isOrderStatus(value: string): value is OrderStatus {
	return (ORDER_STATUSES as readonly string[]).includes(value);
}

export function statusInfo(status: string) {
	return isOrderStatus(status) ? STATUS_LABEL[status] : { label: status, emoji: "•", color: 0x80848e };
}

export function formatPrice(price: number | string): string {
	return `$${Number(price).toFixed(2)}`;
}

export const unixSeconds = (iso: string): number => Math.floor(new Date(iso).getTime() / 1000);

export async function ordersForUser(api: OrdersApi, discordId: string, limit = 25): Promise<Order[]> {
	return api.call<Order[]>("bot_orders_list", { p_discord_id: discordId, p_limit: limit });
}

/** Looks an order up by its code. Pass `ownerDiscordId` to restrict the lookup to that customer's own orders. */
export async function findOrder(api: OrdersApi, code: string, ownerDiscordId?: string): Promise<Order | null> {
	return api.call<Order | null>("bot_orders_get", { p_order_code: code.trim(), p_owner_discord_id: ownerDiscordId ?? null });
}

/** Autocomplete search. Customers are always scoped to their own orders; admins search everything. */
export async function searchOrders(api: OrdersApi, term: string, scope: { ownerDiscordId?: string }): Promise<Order[]> {
	return api.call<Order[]>("bot_orders_search", { p_term: term, p_owner_discord_id: scope.ownerDiscordId ?? null });
}

export type NewOrder = {
	discordId: string;
	discordUsername: string;
	name: string;
	price: number;
	category: OrderCategory;
	service?: string | null;
	description?: string | null;
};

/**
 * Creates an order for a customer. Like the website's own order flow, the customer must have a website
 * profile linked to their Discord (it supplies the required email); the database assigns order_code and status.
 * A customer without one gets an OrderError explaining why.
 */
export async function createOrder(api: OrdersApi, input: NewOrder): Promise<Order> {
	return api.call<Order>("bot_orders_create", {
		p_discord_id: input.discordId,
		p_discord_username: input.discordUsername,
		p_order_name: input.name,
		p_price: input.price,
		p_category: input.category,
		p_service: input.service ?? null,
		p_description: input.description ?? null,
	});
}

export type OrderPatch = Partial<{
	order_name: string;
	price: number;
	category: OrderCategory;
	service: string;
	description: string;
	status: OrderStatus;
}>;

export async function updateOrder(api: OrdersApi, code: string, patch: OrderPatch): Promise<Order | null> {
	if (Object.keys(patch).length === 0) throw new OrderError("Nothing to change — provide at least one field.");
	return api.call<Order | null>("bot_orders_update", { p_order_code: code.trim(), p_patch: patch });
}
