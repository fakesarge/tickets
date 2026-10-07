import ExtendedClient from "../structure/ExtendedClient";
import { Order } from "./orders";
import { buildOrderStatusDm } from "../ui/orders";

export type NotifyResult = "sent" | "failed" | "skipped";

/** DMs the order's customer about a status change. Never throws — a closed DM must not fail the admin's update. */
export async function notifyOrderStatusChange(client: ExtendedClient, order: Order, previousStatus: string): Promise<NotifyResult> {
	if (!order.discord_id) return "skipped";
	try {
		const user = await client.users.fetch(order.discord_id);
		await user.send(buildOrderStatusDm(client, order, previousStatus));
		return "sent";
	} catch (err) {
		console.warn(`Order DM: couldn't notify ${order.discord_id} about ${order.order_code}.`, err instanceof Error ? err.message : err);
		return "failed";
	}
}
