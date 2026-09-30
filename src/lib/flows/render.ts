import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	MessageFlags,
	StringSelectMenuBuilder,
	TextDisplayBuilder,
	type MessageCreateOptions,
	type MessageEditOptions,
} from "discord.js";
import { resolveColor } from "../tickets";
import { brand } from "../../ui/theme";
import { ButtonsStep, FlowState, ModalStep, SelectStep } from "./types";

export const FLOW_CUSTOM_IDS = {
	select: "flow_select",
	back: "flow_nav_back",
	restart: "flow_nav_restart",
	staff: "flow_nav_staff",
} as const;

type FlowPayload = MessageCreateOptions & MessageEditOptions;

export type SummaryEntry = { label: string; value: string };

/** Each entry renders as a bullet + bold-italic label, then its answer in a code block. */
function formatSummary(entries: SummaryEntry[]): string {
	return entries.map((e) => `${brand().emojis.bullet} ***${e.label}:***\n\`\`\`\n${e.value}\n\`\`\``).join("\n");
}

function container(body: string, color?: string): ContainerBuilder {
	return new ContainerBuilder()
		.setAccentColor(resolveColor(color ?? brand().colors.accent, "#B55CFF"))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

function payload(c: ContainerBuilder): FlowPayload {
	return { flags: MessageFlags.IsComponentsV2, components: [c] };
}

function navRow(state: FlowState): ActionRowBuilder<ButtonBuilder> {
	const { emojis } = brand();
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(FLOW_CUSTOM_IDS.back)
			.setLabel("Back")
			.setEmoji(emojis.back)
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(state.history.length === 0),
		new ButtonBuilder().setCustomId(FLOW_CUSTOM_IDS.restart).setLabel("Start Over").setEmoji(emojis.restart).setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId(FLOW_CUSTOM_IDS.staff).setLabel("Talk to Staff").setEmoji(emojis.talkToStaff).setStyle(ButtonStyle.Secondary)
	);
}

/** Plain intro body, no heading — the customer sees this right after the terms are signed. */
export function buildIntroPayload(): FlowPayload {
	return payload(
		container(
			"I'm here to help get you to the right place as quickly as possible.\n" +
				"You won't be able to type in this channel until we hand things off to a team member — just use the buttons and menus below!"
		)
	);
}

export function buildSelectStepPayload(step: SelectStep, state: FlowState): FlowPayload {
	const select = new StringSelectMenuBuilder()
		.setCustomId(FLOW_CUSTOM_IDS.select)
		.setPlaceholder(step.placeholder ?? "Select an option")
		.addOptions(
			step.options.slice(0, 25).map((o) => ({
				label: o.label.slice(0, 100),
				value: o.value,
				description: o.description?.slice(0, 100),
				emoji: o.emoji,
			}))
		);

	return payload(
		container(`## ${step.title}\n${step.body}`)
			.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select))
			.addActionRowComponents(navRow(state))
	);
}

export function buildButtonsStepPayload(step: ButtonsStep, state: FlowState): FlowPayload {
	const optionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
		step.buttons.slice(0, 5).map((b) => {
			const btn = new ButtonBuilder()
				.setCustomId(`flow_btn__${b.value}`)
				.setLabel(b.label)
				.setStyle(b.style ?? ButtonStyle.Secondary);
			if (b.emoji) btn.setEmoji(b.emoji);
			return btn;
		})
	);

	return payload(container(`## ${step.title}\n${step.body}`).addActionRowComponents(optionRow).addActionRowComponents(navRow(state)));
}

export function buildModalStepPayload(step: ModalStep, state: FlowState): FlowPayload {
	const openRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`flow_modalopen__${step.id}`)
			.setLabel(step.openLabel ?? "Continue")
			.setEmoji(brand().emojis.modalContinue)
			.setStyle(ButtonStyle.Success)
	);

	return payload(container(`## ${step.title}\n${step.body}`).addActionRowComponents(openRow).addActionRowComponents(navRow(state)));
}

export function buildResolutionPayload(title: string, body: string, state: FlowState): FlowPayload {
	return payload(container(`## ${brand().emojis.resolved} ${title}\n${body}`).addActionRowComponents(navRow(state)));
}

/**
 * The single message shown when a ticket is handed off to a human: role ping (Components V2
 * messages can't use the top-level `content` field, so it's folded into the text display),
 * heading, summary and footer, all in one container — this replaces the ticket's guided-flow
 * message in place (or is sent fresh if that message is somehow gone).
 */
export function buildEscalationPayload(pingContent: string, entries: SummaryEntry[]): FlowPayload {
	const { emojis, colors } = brand();
	const summary = entries.length > 0 ? formatSummary(entries) : "No additional details were collected before escalation.";

	return payload(
		container(
			(pingContent ? `${pingContent}\n` : "") +
				`# ${emojis.escalation} This one's for our team\n` +
				"This request is best handled by a member of our team. I've already collected the information they'll need.\n\n" +
				"## Support Summary\n" +
				summary +
				"\n\nPlease wait for a team member to respond.",
			colors.escalation
		)
	);
}

export function buildStaffTakeoverClosedStepPayload(): FlowPayload {
	return payload(container("## A staff member has taken over this ticket. The automated agent has stopped."));
}

export function buildStaffTakeoverPayload(staffId: string): FlowPayload {
	return payload(
		container(`## ${brand().emojis.agent} Staff has taken over\n<@${staffId}> is now personally handling this ticket. The automated support agent has stopped.`)
	);
}
