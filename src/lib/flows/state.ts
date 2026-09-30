/** Persistence for flow state. Backed by the `tickets` table so it survives bot restarts. */

import ExtendedClient from "../../structure/ExtendedClient";
import { FlowState } from "./types";

function safeParseObject(raw: string): Record<string, string> {
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed === "object" && parsed ? parsed : {};
	} catch {
		return {};
	}
}

function safeParseArray(raw: string): string[] {
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export async function getFlowState(client: ExtendedClient, channelId: string): Promise<FlowState | null> {
	const ticket = await client.prisma.tickets.findUnique({ where: { channelId } });
	if (!ticket || !ticket.flowStep) return null;

	return {
		ticketId: ticket.id,
		currentStep: ticket.flowStep,
		history: safeParseArray(ticket.flowHistory),
		selections: safeParseObject(ticket.flowSelections),
		responses: safeParseObject(ticket.flowResponses),
		escalated: ticket.escalated,
		staffTakeover: ticket.staffTakeover,
	};
}

export async function saveFlowState(client: ExtendedClient, channelId: string, state: FlowState, flowMessageId?: string): Promise<void> {
	await client.prisma.tickets.update({
		where: { channelId },
		data: {
			flowStep: state.currentStep,
			flowHistory: JSON.stringify(state.history),
			flowSelections: JSON.stringify(state.selections),
			flowResponses: JSON.stringify(state.responses),
			escalated: state.escalated,
			staffTakeover: state.staffTakeover,
			...(flowMessageId ? { flowMessageId } : {}),
		},
	});
}

export async function getFlowMessageId(client: ExtendedClient, channelId: string): Promise<string | null> {
	const ticket = await client.prisma.tickets.findUnique({ where: { channelId }, select: { flowMessageId: true } });
	return ticket?.flowMessageId ?? null;
}
