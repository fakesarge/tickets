import { ButtonStyle } from "discord.js";

/** Special "go to" targets that aren't a plain step id. */
export const ESCALATE = "@escalate" as const;
export type ResolveTarget = `@resolve:${string}`;
export type GoTo = string | typeof ESCALATE | ResolveTarget;

export type SelectOption = {
	value: string;
	label: string;
	description?: string;
	emoji?: string;
	goto: GoTo;
};

export type ButtonOption = {
	value: string;
	label: string;
	emoji?: string;
	style?: ButtonStyle;
	goto: GoTo;
};

export type ModalField = {
	id: string;
	label: string;
	style: "SHORT" | "PARAGRAPH";
	placeholder?: string;
	maxLength?: number;
	required?: boolean;
};

type StepBase = {
	id: string;
	/** Short label used in the staff hand-off summary. */
	title: string;
	/** Body text shown under the title. */
	body: string;
};

export type SelectStep = StepBase & { kind: "select"; placeholder?: string; options: SelectOption[] };
export type ButtonsStep = StepBase & { kind: "buttons"; buttons: ButtonOption[] };
export type ModalStep = StepBase & {
	kind: "modal";
	openLabel?: string;
	modalTitle: string;
	fields: ModalField[];
	goto: GoTo;
};

export type FlowStep = SelectStep | ButtonsStep | ModalStep;

/** A canned answer the bot can give without escalating. */
export type Resolution = {
	key: string;
	title: string;
	body: string;
	/** If true, hand off to staff right after showing this resolution. */
	autoEscalate: boolean;
};

export type FlowState = {
	ticketId: number;
	currentStep: string;
	/** Stack of previously visited step ids, for the Back button. */
	history: string[];
	/** Option label picked at each step title, e.g. { "What can we help with?": "Billing Support" } */
	selections: Record<string, string>;
	/** Free-form answers collected via modals, keyed by field label. */
	responses: Record<string, string>;
	escalated: boolean;
	staffTakeover: boolean;
};
