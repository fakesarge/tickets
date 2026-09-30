/* Billing ticket-type flow: the root menu plus every billing sub-branch. */

import { ESCALATE, FlowStep } from "../types";
import { modal, select } from "../helpers";
import { PURCHASE_CATEGORY_STEP_ID } from "./purchase";

export const BILLING_ROOT_ID = "billing_root";

export const billingSteps: FlowStep[] = [
	select(
		BILLING_ROOT_ID,
		"What can we help you with?",
		"Select the option that best matches your request.",
		[
			{ value: "billing_support", label: "Billing Support", emoji: "🧾", goto: "billing_support_modal" },
			{ value: "purchase", label: "Purchase an Item", emoji: "<:249884cash:1549829672995651604>", goto: PURCHASE_CATEGORY_STEP_ID },
			{ value: "refund", label: "Refund Request", emoji: "<:429042lowwarning:1549829683640672466>", goto: "refund_modal" },
			{ value: "payment_issue", label: "Payment Issue", emoji: "<:685108warn:1549829706009022551>", goto: "payment_issue_category" },
			{ value: "invoice", label: "Invoice / Receipt", emoji: "📄", goto: "invoice_category" },
			{ value: "discount", label: "Discount / Coupon", emoji: "<:463819giveaway:1549829727827529788>", goto: "discount_category" },
			{ value: "vip", label: "Subscription / VIP", emoji: "<:693596winterstar:1549829707564847104>", goto: "vip_root" },
			{ value: "other", label: "Other Billing Question", emoji: "<:685951info:1549829734416781353>", goto: "billing_other_modal" },
		],
		"Select a billing topic"
	),

	modal(
		"billing_support_modal",
		"Billing support",
		"A few quick details so our team can jump straight in.",
		[
			{ id: "issue", label: "What is the billing issue?", style: "PARAGRAPH", maxLength: 500, required: true },
			{ id: "order_ref", label: "Order / invoice number (if any)", style: "SHORT", maxLength: 100, required: false },
			{ id: "what_happened", label: "What happened?", style: "PARAGRAPH", maxLength: 1000, required: true },
		],
		ESCALATE
	),

	modal(
		"refund_modal",
		"Refund request",
		"We review every refund individually. Share the details below and our team will follow up.",
		[
			{ id: "purchased", label: "What did you purchase?", style: "SHORT", maxLength: 200, required: true },
			{ id: "order_ref", label: "Order / invoice number", style: "SHORT", maxLength: 100, required: false },
			{ id: "reason", label: "Why are you requesting a refund?", style: "PARAGRAPH", maxLength: 1000, required: true },
		],
		"@resolve:refund_policy"
	),

	select(
		"payment_issue_category",
		"What's going on with the payment?",
		"Select the option that best describes it.",
		[
			{ value: "failed", label: "Payment failed", emoji: "<:685108warn:1549829706009022551>", goto: "payment_issue_modal" },
			{ value: "pending", label: "Payment pending", emoji: "<:685108warn:1549829706009022551>", goto: "payment_issue_modal" },
			{ value: "charged_not_received", label: "Charged but order not received", emoji: "<:685108warn:1549829706009022551>", goto: "payment_issue_modal" },
			{ value: "charged_multiple", label: "Charged multiple times", emoji: "<:685108warn:1549829706009022551>", goto: "payment_issue_modal" },
			{ value: "wrong_amount", label: "Wrong amount charged", emoji: "<:685108warn:1549829706009022551>", goto: "payment_issue_modal" },
			{ value: "payment_method", label: "Payment method problem", emoji: "<:685108warn:1549829706009022551>", goto: "payment_issue_modal" },
			{ value: "other", label: "Other", emoji: "<:685951info:1549829734416781353> ", goto: "payment_issue_modal" },
		],
		"Select an option"
	),
	modal(
		"payment_issue_modal",
		"Payment issue details",
		"Share what you can and our team will look into it.",
		[
			{ id: "order_ref", label: "Order / invoice number (if any)", style: "SHORT", maxLength: 100, required: false },
			{ id: "details", label: "What happened?", style: "PARAGRAPH", maxLength: 1000, required: true },
		],
		ESCALATE
	),

	select(
		"invoice_category",
		"What do you need?",
		"Select the option that best matches your request.",
		[
			{ value: "need_invoice", label: "Need an invoice", emoji: "🧾", goto: "invoice_modal" },
			{ value: "need_receipt", label: "Need a receipt", emoji: "🧾", goto: "invoice_modal" },
			{ value: "cant_find", label: "Can't find previous purchase", emoji: "<:45954zoomglass:1322304702255202344>", goto: "invoice_modal" },
			{ value: "incorrect_info", label: "Invoice has incorrect information", emoji: "<:904340pencil:1549829719636189377>", goto: "invoice_modal" },
			{ value: "other", label: "Other", emoji: "<:685951info:1549829734416781353> ", goto: "invoice_modal" },
		],
		"Select an option"
	),
	modal(
		"invoice_modal",
		"Invoice / receipt details",
		"A couple of details so our team can pull up the right order.",
		[
			{ id: "order_ref", label: "Order number / purchase date (if known)", style: "SHORT", maxLength: 150, required: false },
			{ id: "details", label: "Additional details", style: "PARAGRAPH", maxLength: 1000, required: false },
		],
		ESCALATE
	),

	select(
		"discount_category",
		"What's the issue?",
		"Select the option that best matches your request.",
		[
			{ value: "not_working", label: "Coupon isn't working", emoji: "<:249884cash:1549829672995651604> ", goto: "discount_modal" },
			{ value: "missing", label: "Discount missing", emoji: "<:685951info:1549829734416781353> ", goto: "discount_modal" },
			{ value: "first_order", label: "First-order discount", emoji: "<:685951info:1549829734416781353> ", goto: "discount_modal" },
			{ value: "promo_question", label: "Sale / promotion question", emoji: "<:1882megaphone:1549829655102750770>", goto: "discount_modal" },
			{ value: "other", label: "Other", emoji: "<:685951info:1549829734416781353> ", goto: "discount_modal" },
		],
		"Select an option"
	),
	modal(
		"discount_modal",
		"Discount / coupon details",
		"Let us know the details — we can't generate or verify codes automatically.",
		[
			{ id: "code", label: "Coupon / discount code (if any)", style: "SHORT", maxLength: 100, required: false },
			{ id: "details", label: "What's happening?", style: "PARAGRAPH", maxLength: 1000, required: true },
		],
		"@resolve:discount_notice"
	),

	modal(
		"billing_other_modal",
		"Tell us more",
		"Briefly describe your billing question.",
		[{ id: "details", label: "What's your question?", style: "PARAGRAPH", maxLength: 1000, required: true }],
		ESCALATE
	),
];

export const VIP_ROOT_ID = "vip_root";

export const vipSteps: FlowStep[] = [
	select(
		VIP_ROOT_ID,
		"What do you need help with?",
		"Select the option that best matches your VIP / subscription question.",
		[
			{ value: "how_it_works", label: "How does VIP work?", emoji: "<:45954zoomglass:1322304702255202344>", goto: "@resolve:vip_info" },
			{ value: "cant_access", label: "Can't access VIP content", emoji: "<:34452unlock:1322304695313633394>", goto: "vip_modal" },
			{ value: "role_missing", label: "VIP role missing", emoji: "<:34452unlock:1322304695313633394>", goto: "vip_modal" },
			{ value: "payment_issue", label: "Payment / subscription issue", emoji: "<:249884cash:1549829672995651604>", goto: "vip_modal" },
			{ value: "cancel", label: "Cancel subscription", emoji: "<:570616gearicon:1549829702443737258>", goto: "vip_modal" },
			{ value: "upgrade", label: "Upgrade / change subscription", emoji: "<:693596winterstar:1549829707564847104>", goto: "vip_modal" },
			{ value: "content_question", label: "VIP content question", emoji: "<:685951info:1549829734416781353>", goto: "vip_modal" },
			{ value: "other", label: "Other", emoji: "<:685951info:1549829734416781353> ", goto: "vip_modal" },
		],
		"Select an option"
	),
	modal(
		"vip_modal",
		"VIP / subscription details",
		"Share the details and our team will take a look at your account.",
		[
			{ id: "order_ref", label: "Order / subscription reference (if any)", style: "SHORT", maxLength: 150, required: false },
			{ id: "details", label: "What's happening?", style: "PARAGRAPH", maxLength: 1000, required: true },
		],
		ESCALATE
	),
];
