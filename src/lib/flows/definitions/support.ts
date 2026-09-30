/* General "Support" ticket-type flow: general questions, technical support, order/project support, revision support. */

import { ESCALATE, FlowStep } from "../types";
import { modal, select } from "../helpers";

export const SUPPORT_ROOT_ID = "support_root";
export const REVISION_ROOT_ID = "revision_root";

export const supportSteps: FlowStep[] = [
	select(
		SUPPORT_ROOT_ID,
		"What can we help you with?",
		"Select the option that best matches your request.",
		[
			{ value: "general", label: "General Question", emoji: "<:685951info:1549829734416781353>", goto: "general_category" },
			{ value: "technical", label: "Technical Support", emoji: "<:685951info:1549829734416781353>", goto: "technical_category" },
			{ value: "product", label: "Product / Download Issue", emoji: "<:685951info:1549829734416781353>", goto: "product_category" },
			{ value: "order", label: "Order / Project Support", emoji: "<:685951info:1549829734416781353>", goto: "order_category" },
			{ value: "revision", label: "Revision Request", emoji: "<:685951info:1549829734416781353>", goto: REVISION_ROOT_ID },
			{ value: "other", label: "Something Else", emoji: "<:685951info:1549829734416781353>", goto: "support_other_modal" },
		],
		"Select a topic"
	),

	// General questions
	select(
		"general_category",
		"What's your question about?",
		"Select the closest match.",
		[
			"Pricing",
			"Services",
			"Portfolio",
			"Turnaround Time",
			"Custom Work",
			"Licensing",
			"Commercial Use",
			"Product Availability",
			"VIP",
			"Discord / Community",
			"Other",
		].map((label) => ({ value: label.toLowerCase().replace(/[^a-z]+/g, "_"), label, goto: "general_modal" })),
		"Select a category"
	),
	modal(
		"general_modal",
		"Your question",
		"Tell us more and we'll make sure you get an accurate answer.",
		[{ id: "question", label: "What would you like to know?", style: "PARAGRAPH", maxLength: 1000, required: true }],
		"@resolve:general_notice"
	),

	// Technical support
	select(
		"technical_category",
		"What kind of technical issue?",
		"Select the closest match.",
		[
			"Installation",
			"Blender",
			"FiveM",
			"Loading Screens",
			"Assets",
			"File Compatibility",
			"Missing Dependencies",
			"Product Not Working",
			"Rendering / Export Issue",
			"Performance Issue",
			"Other",
		].map((label) => ({ value: label.toLowerCase().replace(/[^a-z]+/g, "_"), label, goto: "technical_modal" })),
		"Select a category"
	),
	modal(
		"technical_modal",
		"Technical details",
		"So we don't guess: what have you tried, and what exactly is happening?",
		[
			{ id: "issue", label: "Describe the issue", style: "PARAGRAPH", maxLength: 1000, required: true },
			{ id: "steps_tried", label: "What have you already tried?", style: "PARAGRAPH", maxLength: 500, required: false },
			{ id: "error", label: "Exact error message (if any)", style: "SHORT", maxLength: 200, required: false },
		],
		ESCALATE
	),

	// Product / digital asset support
	select(
		"product_category",
		"What's the product issue?",
		"Select the option that best matches your request.",
		[
			"Can't Download Product",
			"Download Link Isn't Working",
			"Missing Files",
			"Corrupted File",
			"Product Doesn't Work",
			"Product Compatibility Question",
			"Installation Question",
			"Product Information",
			"Licensing Question",
			"Existing Purchase",
			"Other",
		].map((label) => ({ value: label.toLowerCase().replace(/[^a-z]+/g, "_"), label, goto: "product_modal" })),
		"Select a category"
	),
	modal(
		"product_modal",
		"Product details",
		"Share the product name/link and what's happening — we'll help however we can.",
		[
			{ id: "product", label: "Product name or link", style: "SHORT", maxLength: 200, required: true },
			{ id: "details", label: "What's happening?", style: "PARAGRAPH", maxLength: 1000, required: true },
		],
		ESCALATE
	),

	// Order / project support
	select(
		"order_category",
		"What do you need?",
		"Select the option that best matches your request.",
		[
			{ value: "wheres_my_order", label: "Where is my order?", emoji: "📦", goto: "order_modal" },
			{ value: "project_status", label: "Project status", emoji: "📊", goto: "order_modal" },
			{ value: "delivery_question", label: "Delivery question", emoji: "🚚", goto: "order_modal" },
			{ value: "deadline_question", label: "Deadline question", emoji: "⏳", goto: "order_modal" },
			{ value: "revision_request", label: "Revision request", emoji: "✏️", goto: REVISION_ROOT_ID },
			{ value: "submit_files", label: "Need to submit files", emoji: "📁", goto: "order_modal" },
			{ value: "submit_references", label: "Need to submit references", emoji: "🔗", goto: "order_modal" },
			{ value: "wrong_files", label: "Wrong files delivered", emoji: "⚠️", goto: "order_modal" },
			{ value: "missing_files", label: "Missing files", emoji: "❗", goto: "order_modal" },
			{ value: "project_issue", label: "Project issue", emoji: "🐞", goto: "order_modal" },
			{ value: "other", label: "Other", emoji: "❓", goto: "order_modal" },
		],
		"Select an option"
	),
	modal(
		"order_modal",
		"Order / project details",
		"A couple of details so our team can find your order quickly.",
		[
			{ id: "order_ref", label: "Order / project reference (if known)", style: "SHORT", maxLength: 150, required: false },
			{ id: "details", label: "Details", style: "PARAGRAPH", maxLength: 1000, required: true },
		],
		ESCALATE
	),

	// Revision support (shared entry point from multiple flows)
	select(
		REVISION_ROOT_ID,
		"What's the revision issue?",
		"Select the option that best matches your request.",
		[
			{ value: "request", label: "Request a revision", emoji: "✏️", goto: "revision_modal" },
			{ value: "not_expected", label: "Revision isn't what I expected", emoji: "😕", goto: "revision_modal" },
			{ value: "need_another", label: "Need another revision", emoji: "🔁", goto: "revision_modal" },
			{ value: "deadline", label: "Revision deadline", emoji: "⏳", goto: "revision_modal" },
			{ value: "policy_question", label: "Revision policy question", emoji: "❓", goto: "@resolve:revision_policy" },
			{ value: "other", label: "Other", emoji: "❓", goto: "revision_modal" },
		],
		"Select an option"
	),
	modal(
		"revision_modal",
		"Revision details",
		"So our team can act fast on this.",
		[
			{ id: "order_ref", label: "Order / project reference", style: "SHORT", maxLength: 150, required: false },
			{ id: "what_to_change", label: "What needs changing?", style: "PARAGRAPH", maxLength: 1000, required: true },
			{ id: "reference", label: "Reference / example (link, optional)", style: "SHORT", maxLength: 300, required: false },
		],
		ESCALATE
	),

	modal(
		"support_other_modal",
		"Tell us more",
		"Briefly describe what you need help with.",
		[{ id: "details", label: "What can we help with?", style: "PARAGRAPH", maxLength: 1000, required: true }],
		ESCALATE
	),
];
