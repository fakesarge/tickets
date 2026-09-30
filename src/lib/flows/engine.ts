/**
 * The guided-conversation engine: a small state machine that walks a customer through a
 * flow (see ./definitions) and either resolves their request automatically or hands it
 * off to staff. Reuses the ticket record for persistence; never touches ticket creation,
 * permissions, claiming, or closing beyond locking/unlocking chat.
 */

import {
	ActionRowBuilder,
	ButtonInteraction,
	ChannelType,
	ModalBuilder,
	ModalSubmitInteraction,
	StringSelectMenuInteraction,
	TextChannel,
	TextInputBuilder,
	TextInputStyle,
} from "discord.js";
import ExtendedClient from "../../structure/ExtendedClient";
import { getTicketType } from "../tickets";
import { MSG } from "../../ui/messages";
import { brand } from "../../ui/theme";
import { TicketType } from "../types";
import { escalateTicket, unlockTicketChat } from "./escalation";
import {
	buildButtonsStepPayload,
	buildIntroPayload,
	buildModalStepPayload,
	buildResolutionPayload,
	buildSelectStepPayload,
	buildStaffTakeoverClosedStepPayload,
	buildStaffTakeoverPayload,
	FLOW_CUSTOM_IDS,
} from "./render";
import { getFlowState, saveFlowState } from "./state";
import { getEntryStepId, RESOLUTIONS, STEP_MAP } from "./registry";
import { FlowState, GoTo, ModalStep } from "./types";

type Ctx = { channel: TextChannel; ticketType: TicketType; state: FlowState };

function fillUrl(text: string): string {
	return text.replace(/\{\{TERMS_URL\}\}/g, brand().websiteUrl);
}

export function hasFlow(ticketTypeCodeName: string): boolean {
	return getEntryStepId(ticketTypeCodeName) !== undefined;
}

async function loadContext(client: ExtendedClient, channel: TextChannel): Promise<Ctx | null> {
	const ticket = await client.prisma.tickets.findUnique({ where: { channelId: channel.id } });
	if (!ticket) return null;
	const ticketType = getTicketType(client, ticket.typeCodeName);
	if (!ticketType) return null;
	const state = await getFlowState(client, channel.id);
	if (!state) return null;
	return { channel, ticketType, state };
}

async function persist(client: ExtendedClient, channel: TextChannel, state: FlowState, flowMessageId?: string) {
	await saveFlowState(client, channel.id, state, flowMessageId);
}

async function renderStep(client: ExtendedClient, ctx: Ctx): Promise<void> {
	const { channel, state } = ctx;
	const step = STEP_MAP[state.currentStep];
	if (!step) return;

	const templated = { ...step, body: fillUrl(step.body) } as typeof step;
	const payload =
		templated.kind === "select"
			? buildSelectStepPayload(templated, state)
			: templated.kind === "buttons"
				? buildButtonsStepPayload(templated, state)
				: buildModalStepPayload(templated, state);

	const ticket = await client.prisma.tickets.findUnique({ where: { channelId: channel.id }, select: { flowMessageId: true } });
	const existing = ticket?.flowMessageId ? await channel.messages.fetch(ticket.flowMessageId).catch(() => null) : null;

	if (existing) {
		await existing.edit(payload).catch((e) => console.error(e));
		await persist(client, channel, state);
		return;
	}

	const sent = await channel.send(payload).catch((e) => {
		console.error(e);
		return null;
	});
	await persist(client, channel, state, sent?.id);
}

async function closeOutForStaffTakeover(client: ExtendedClient, channel: TextChannel) {
	const messageId = (await client.prisma.tickets.findUnique({ where: { channelId: channel.id }, select: { flowMessageId: true } }))?.flowMessageId;
	if (!messageId) return;
	const msg = await channel.messages.fetch(messageId).catch(() => null);
	await msg?.edit(buildStaffTakeoverClosedStepPayload()).catch((e) => console.error(e));
}

/** Advances the state machine towards `goto`, persisting and rendering as needed. */
async function advance(client: ExtendedClient, ctx: Ctx, goto: GoTo): Promise<void> {
	const { channel, state, ticketType } = ctx;
	state.history.push(state.currentStep);

	if (goto === "@escalate") {
		await escalateTicket(client, channel, ticketType, state);
		await persist(client, channel, state);
		return;
	}

	if (goto.startsWith("@resolve:")) {
		const resolution = RESOLUTIONS[goto.slice("@resolve:".length)];
		if (!resolution) return;

		const payload = buildResolutionPayload(resolution.title, fillUrl(resolution.body), state);
		const messageId = (await client.prisma.tickets.findUnique({ where: { channelId: channel.id }, select: { flowMessageId: true } }))?.flowMessageId;
		if (messageId) {
			const msg = await channel.messages.fetch(messageId).catch(() => null);
			await msg?.edit(payload).catch((e) => console.error(e));
		}
		await persist(client, channel, state);

		if (resolution.autoEscalate) await escalateTicket(client, channel, ticketType, state);
		await persist(client, channel, state);
		return;
	}

	if (!STEP_MAP[goto]) {
		console.error(`Flow engine: unknown step id "${goto}"`);
		state.history.pop();
		return;
	}
	state.currentStep = goto;
	await renderStep(client, ctx);
}

export async function startFlow(client: ExtendedClient, channel: TextChannel, ticketId: number, ticketType: TicketType): Promise<void> {
	const entryStepId = getEntryStepId(ticketType.codeName);
	if (!entryStepId) return;

	const state: FlowState = {
		ticketId,
		currentStep: entryStepId,
		history: [],
		selections: {},
		responses: {},
		escalated: false,
		staffTakeover: false,
	};

	await channel.send(buildIntroPayload()).catch((e) => console.error(e));
	await persist(client, channel, state);
	await renderStep(client, { channel, ticketType, state });
}

export async function handleFlowSelect(interaction: StringSelectMenuInteraction, client: ExtendedClient): Promise<void> {
	if (interaction.channel?.type !== ChannelType.GuildText) return;
	const ctx = await loadContext(client, interaction.channel);
	if (!ctx) return;
	if (ctx.state.staffTakeover) return void interaction.reply({ content: MSG.flowStaffHandling, ephemeral: true }).catch(() => {});

	const step = STEP_MAP[ctx.state.currentStep];
	if (!step || step.kind !== "select") return;

	const option = step.options.find((o) => o.value === interaction.values[0]);
	if (!option) return;

	await interaction.deferUpdate().catch(() => {});
	ctx.state.selections[step.title] = option.label;
	await advance(client, ctx, option.goto);
}

export async function handleFlowButton(interaction: ButtonInteraction, client: ExtendedClient): Promise<void> {
	if (interaction.channel?.type !== ChannelType.GuildText) return;
	const channel = interaction.channel;
	const customId = interaction.customId;

	if (customId === FLOW_CUSTOM_IDS.staff) {
		const ctx = await loadContext(client, channel);
		if (!ctx) return;
		if (ctx.state.staffTakeover) return void interaction.reply({ content: MSG.flowStaffHandling, ephemeral: true }).catch(() => {});
		await interaction.deferUpdate().catch(() => {});
		await advance(client, ctx, "@escalate");
		return;
	}

	if (customId === FLOW_CUSTOM_IDS.restart) {
		const ctx = await loadContext(client, channel);
		if (!ctx) return;
		if (ctx.state.staffTakeover) return void interaction.reply({ content: MSG.flowStaffHandling, ephemeral: true }).catch(() => {});
		await interaction.deferUpdate().catch(() => {});
		const entryStepId = getEntryStepId(ctx.ticketType.codeName);
		if (!entryStepId) return;
		ctx.state.currentStep = entryStepId;
		ctx.state.history = [];
		ctx.state.selections = {};
		ctx.state.responses = {};
		await renderStep(client, ctx);
		return;
	}

	if (customId === FLOW_CUSTOM_IDS.back) {
		const ctx = await loadContext(client, channel);
		if (!ctx) return;
		if (ctx.state.staffTakeover || ctx.state.history.length === 0) return void interaction.deferUpdate().catch(() => {});
		await interaction.deferUpdate().catch(() => {});
		ctx.state.currentStep = ctx.state.history.pop() as string;
		await renderStep(client, ctx);
		return;
	}

	if (customId.startsWith("flow_btn__")) {
		const ctx = await loadContext(client, channel);
		if (!ctx) return;
		if (ctx.state.staffTakeover) return void interaction.reply({ content: MSG.flowStaffHandling, ephemeral: true }).catch(() => {});
		const step = STEP_MAP[ctx.state.currentStep];
		if (!step || step.kind !== "buttons") return;
		const value = customId.replace("flow_btn__", "");
		const option = step.buttons.find((b) => b.value === value);
		if (!option) return;
		await interaction.deferUpdate().catch(() => {});
		ctx.state.selections[step.title] = option.label;
		await advance(client, ctx, option.goto);
		return;
	}

	if (customId.startsWith("flow_modalopen__")) {
		const ctx = await loadContext(client, channel);
		if (!ctx) return;
		if (ctx.state.staffTakeover) return void interaction.reply({ content: MSG.flowStaffHandling, ephemeral: true }).catch(() => {});
		const stepId = customId.replace("flow_modalopen__", "");
		const step = STEP_MAP[stepId] as ModalStep | undefined;
		if (!step || step.kind !== "modal") return;

		const modal = new ModalBuilder().setCustomId(`flow_modalsubmit__${stepId}`).setTitle(step.modalTitle);
		modal.addComponents(
			step.fields.slice(0, 5).map((f) =>
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder()
						.setCustomId(f.id)
						.setLabel(f.label.slice(0, 45))
						.setStyle(f.style === "SHORT" ? TextInputStyle.Short : TextInputStyle.Paragraph)
						.setPlaceholder(f.placeholder ?? "")
						.setMaxLength(f.maxLength ?? 1000)
						.setRequired(f.required ?? true)
				)
			)
		);
		await interaction.showModal(modal).catch((e) => console.error(e));
	}
}

export async function handleFlowModalSubmit(interaction: ModalSubmitInteraction, client: ExtendedClient): Promise<void> {
	if (interaction.channel?.type !== ChannelType.GuildText) return;
	const channel = interaction.channel;
	const stepId = interaction.customId.replace("flow_modalsubmit__", "");
	const ctx = await loadContext(client, channel);
	if (!ctx) return;
	if (ctx.state.staffTakeover) return void interaction.reply({ content: MSG.flowStaffHandling, ephemeral: true }).catch(() => {});

	const step = STEP_MAP[stepId] as ModalStep | undefined;
	if (!step || step.kind !== "modal") return;

	await interaction.deferReply({ ephemeral: true }).catch(() => {});
	for (const field of step.fields) {
		const value = interaction.fields.getTextInputValue(field.id)?.trim();
		if (value) ctx.state.responses[field.label] = value;
	}

	await advance(client, ctx, step.goto);
	await interaction.editReply({ content: MSG.flowModalAck }).catch(() => {});
}

/** Called when a staff member claims the ticket, so claiming doubles as taking over the flow. */
export async function markStaffTakeover(client: ExtendedClient, channel: TextChannel, staffId: string): Promise<void> {
	const ctx = await loadContext(client, channel);
	if (!ctx || ctx.state.staffTakeover) return;
	ctx.state.staffTakeover = true;
	await persist(client, channel, ctx.state);
	await closeOutForStaffTakeover(client, channel);
	await unlockTicketChat(client, channel);
	await channel.send(buildStaffTakeoverPayload(staffId)).catch((e) => console.error(e));
}
