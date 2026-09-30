/** Small factory functions to keep flow definitions short and declarative. */

import { ButtonStyle } from "discord.js";
import { ButtonOption, ButtonsStep, GoTo, ModalField, ModalStep, SelectOption, SelectStep } from "./types";

export function select(id: string, title: string, body: string, options: SelectOption[], placeholder?: string): SelectStep {
	return { id, kind: "select", title, body, options, placeholder };
}

export function buttons(id: string, title: string, body: string, options: ButtonOption[]): ButtonsStep {
	return { id, kind: "buttons", title, body, buttons: options };
}

export function modal(id: string, title: string, body: string, fields: ModalField[], goto: GoTo, openLabel?: string): ModalStep {
	return { id, kind: "modal", title, body, fields, goto, openLabel, modalTitle: title.slice(0, 45) };
}

/** The "do you already know what you want?" button pair. */
export const yesNo = (_idPrefix: string, yesGoto: GoTo, noGoto: GoTo): ButtonOption[] => [
	{ value: "yes", label: "Yes, I have a specific idea", emoji: "✅", style: ButtonStyle.Success, goto: yesGoto },
	{ value: "no", label: "No, I need help deciding", emoji: "🤔", style: ButtonStyle.Secondary, goto: noGoto },
];
