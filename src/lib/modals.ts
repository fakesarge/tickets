import { ActionRowBuilder, ModalBuilder, ModalSubmitInteraction, TextInputBuilder, TextInputStyle } from "discord.js";
import { brand } from "../ui/theme";
import { TicketQuestion, TicketType } from "./types";

function questionInput(q: TicketQuestion, customId: string): ActionRowBuilder<TextInputBuilder> {
	const input = new TextInputBuilder()
		.setCustomId(customId)
		.setLabel(q.label.slice(0, 45))
		.setStyle(q.style === "SHORT" ? TextInputStyle.Short : TextInputStyle.Paragraph)
		.setMaxLength(q.maxLength ?? 1000)
		.setRequired(q.required ?? true);
	if (q.placeholder) input.setPlaceholder(q.placeholder);
	return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

/**
 * The signature + questions modal shown after "Agree To Terms". Billing gets its own fixed
 * 3-field shape (purchase type / details / misc); every other type uses up to 4 of its
 * configured `questions` (Discord allows 5 fields total, one of which is the signature).
 */
export function buildTermsModal(ticketType: TicketType): ModalBuilder {
	const modal = new ModalBuilder().setCustomId(`tosIntake__${ticketType.codeName}`).setTitle(`${brand().name} — Terms, signature & details`.slice(0, 45));

	modal.addComponents(
		new ActionRowBuilder<TextInputBuilder>().addComponents(
			new TextInputBuilder()
				.setCustomId("tos_sig")
				.setLabel("Digital signature")
				.setStyle(TextInputStyle.Paragraph)
				.setPlaceholder("Type your name exactly as you agree to the terms above.")
				.setMinLength(2)
				.setMaxLength(500)
				.setRequired(true)
		)
	);

	if (ticketType.codeName === "billing") {
		modal.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId("input_billing_purchase")
					.setLabel("Purchase type (VFX, GFX, or Other)")
					.setStyle(TextInputStyle.Short)
					.setPlaceholder("VFX, GFX, or Other")
					.setMaxLength(40)
					.setRequired(true)
			),
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId("input_billing_0")
					.setLabel("Describe what you need")
					.setStyle(TextInputStyle.Paragraph)
					.setPlaceholder("Deliverables, style, references, deadline…")
					.setMaxLength(1000)
					.setRequired(true)
			),
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId("input_billing_1")
					.setLabel("Miscellaneous (optional)")
					.setStyle(TextInputStyle.Paragraph)
					.setPlaceholder("Promo codes, invoice notes…")
					.setMaxLength(1000)
					.setRequired(false)
			)
		);
		return modal;
	}

	ticketType.questions.slice(0, 4).forEach((q, i) => modal.addComponents(questionInput(q, `input_${ticketType.codeName}_${i}`)));
	return modal;
}

type Answers = { signature: string; reasonText: string };

/** Mirrors the original "Purchase: X | Details: Y | Misc: Z | Digital signature: sig" reason format. */
export function readTermsModal(interaction: ModalSubmitInteraction, ticketType: TicketType): Answers {
	const signature = interaction.fields.getTextInputValue("tos_sig").trim();
	const chunks: string[] = [];

	if (ticketType.codeName === "billing") {
		chunks.push(`Purchase: ${interaction.fields.getTextInputValue("input_billing_purchase")}`);
		chunks.push(`Details: ${interaction.fields.getTextInputValue("input_billing_0")}`);
		chunks.push(`Misc: ${interaction.fields.getTextInputValue("input_billing_1") ?? ""}`);
	} else if (ticketType.questions.length === 0) {
		chunks.push("No additional intake fields.");
	} else {
		ticketType.questions.slice(0, 4).forEach((q, i) => chunks.push(`${q.label}: ${interaction.fields.getTextInputValue(`input_${ticketType.codeName}_${i}`)}`));
	}

	let reasonText = chunks.join(" | ");
	if (signature) reasonText += ` | Digital signature: ${signature}`;
	return { signature, reasonText };
}
