/* "Purchase an Item" flow: product selection + product-specific questions + the deep custom-commission chain. */

import { ButtonStyle } from "discord.js";
import { ESCALATE, FlowStep } from "../types";
import { buttons, modal, select, yesNo } from "../helpers";

const existingOrCustom = (id: string, product: string) =>
	buttons(id, `${product}: existing or custom?`, "Are you looking for something we already offer, or a custom piece made just for you?", [
		{ value: "existing", label: "Existing product", emoji: "<:435031shoppingcart:1549829690641088703>", style: ButtonStyle.Secondary, goto: `${id}_existing` },
		{ value: "custom", label: "Custom work", emoji: "<:904340pencil:1549829719636189377>", style: ButtonStyle.Success, goto: `${id}_custom` },
	]);

const existingModal = (id: string, product: string) =>
	modal(
		`${id}_existing`,
		`${product}: existing product`,
		"Which product are you interested in, and what's your question?",
		[
			{ id: "product", label: "Product name or link", style: "SHORT", maxLength: 200, required: true },
			{ id: "question", label: "Your question", style: "PARAGRAPH", maxLength: 1000, required: true },
		],
		ESCALATE
	);

const customModal = (id: string, product: string) =>
	modal(
		`${id}_custom`,
		`Custom ${product}`,
		`Tell us about the custom ${product.toLowerCase()} you'd like. Note: you've already agreed to our terms of service ✅`,
		[
			{ id: "description", label: "What are you looking to have created?", style: "PARAGRAPH", maxLength: 1000, required: true },
			{ id: "style", label: "Desired style", style: "SHORT", maxLength: 200, required: false },
			{ id: "references", label: "Reference links (if any)", style: "PARAGRAPH", maxLength: 500, required: false },
			{ id: "deadline", label: "Desired deadline", style: "SHORT", maxLength: 100, required: false },
		],
		ESCALATE
	);

export const PURCHASE_CATEGORY_STEP_ID = "purchase_category";

export const purchaseSteps: FlowStep[] = [
	select(
		PURCHASE_CATEGORY_STEP_ID,
		"What would you like to purchase?",
		"Select the type of product you're interested in.",
		[
			{ value: "gfx", label: "GFX", emoji: "🖼️", goto: "purchase_gfx" },
			{ value: "vfx", label: "VFX", emoji: "🎬", goto: "purchase_vfx" },
			{ value: "3d", label: "3D / Blender", emoji: "🧊", goto: "purchase_3d" },
			{ value: "loading_screen", label: "Loading Screen", emoji: "⏳", goto: "purchase_loading_screen" },
			{ value: "template", label: "Template / Asset", emoji: "📦", goto: "purchase_template" },
			{ value: "vip", label: "VIP", emoji: "<:693596winterstar:1549829707564847104>", goto: "vip_root" },
			{ value: "other", label: "Other", emoji: "<:685951info:1549829734416781353>", goto: "purchase_other" },
		],
		"Select a product type"
	),

	// GFX
	existingOrCustom("purchase_gfx", "GFX"),
	existingModal("purchase_gfx", "GFX"),
	customModal("purchase_gfx", "GFX"),

	// VFX — deeper, per the guided example in the spec
	select(
		"purchase_vfx",
		"What are you looking for?",
		"Pick the option that best matches what you need.",
		[
			{ value: "custom_vfx", label: "Custom VFX", emoji: "✨", goto: "vfx_idea_check" },
			{ value: "existing_vfx_asset", label: "Existing VFX Asset", emoji: "🎞️", goto: "purchase_vfx_existing" },
			{ value: "3d_intro", label: "3D Intro", emoji: "🎥", goto: "vfx_idea_check" },
			{ value: "server_showcase", label: "Server Showcase", emoji: "🌆", goto: "vfx_idea_check" },
			{ value: "advertisement", label: "Advertisement", emoji: "📢", goto: "vfx_idea_check" },
			{ value: "other", label: "Other", emoji: "❓", goto: "vfx_idea_check" },
		],
		"Select an option"
	),
	existingModal("purchase_vfx", "VFX"),
	buttons("vfx_idea_check", "Do you already know what you want?", "This helps us route your request correctly.", yesNo("vfx", "vfx_custom_modal", "@resolve:need_help_deciding")),
	modal(
		"vfx_custom_modal",
		"Tell us about your VFX",
		"Tell us briefly what you'd like created. Note: you've already agreed to our terms of service ✅",
		[
			{ id: "description", label: "What would you like created?", style: "PARAGRAPH", maxLength: 1000, required: true },
			{ id: "purpose", label: "What's it for? (server, video, ad…)", style: "SHORT", maxLength: 200, required: false },
			{ id: "references", label: "Reference links (if any)", style: "PARAGRAPH", maxLength: 500, required: false },
			{ id: "deadline", label: "Desired deadline", style: "SHORT", maxLength: 100, required: false },
		],
		ESCALATE
	),

	// 3D / Blender
	select(
		"purchase_3d",
		"What kind of 3D work?",
		"Select the type of 3D / Blender work you need.",
		[
			{ value: "3d_intro", label: "3D Intro", emoji: "🎥", goto: "3d_idea_check" },
			{ value: "3d_model", label: "3D Model", emoji: "🧊", goto: "3d_idea_check" },
			{ value: "render", label: "Render", emoji: "🖥️", goto: "3d_idea_check" },
			{ value: "animation", label: "Animation", emoji: "🎞️", goto: "3d_idea_check" },
			{ value: "other", label: "Other", emoji: "❓", goto: "3d_idea_check" },
		],
		"Select an option"
	),
	buttons("3d_idea_check", "Do you already know what you want?", "This helps us route your request correctly.", yesNo("3d", "3d_custom_modal", "@resolve:need_help_deciding")),
	modal(
		"3d_custom_modal",
		"Tell us about your 3D project",
		"Tell us briefly what you'd like created. Note: you've already agreed to our terms of service ✅",
		[
			{ id: "description", label: "What would you like created?", style: "PARAGRAPH", maxLength: 1000, required: true },
			{ id: "specs", label: "Size / duration / specifications", style: "SHORT", maxLength: 200, required: false },
			{ id: "references", label: "Reference links (if any)", style: "PARAGRAPH", maxLength: 500, required: false },
			{ id: "deadline", label: "Desired deadline", style: "SHORT", maxLength: 100, required: false },
		],
		ESCALATE
	),

	// Loading Screen
	existingOrCustom("purchase_loading_screen", "Loading Screen"),
	existingModal("purchase_loading_screen", "Loading Screen"),
	customModal("purchase_loading_screen", "Loading Screen"),

	// Template / Asset
	existingOrCustom("purchase_template", "Template / Asset"),
	existingModal("purchase_template", "Template / Asset"),
	customModal("purchase_template", "Template / Asset"),

	// Other
	modal(
		"purchase_other",
		"Tell us what you're after",
		"Briefly describe what you'd like to purchase.",
		[{ id: "description", label: "What would you like to purchase?", style: "PARAGRAPH", maxLength: 1000, required: true }],
		ESCALATE
	),
];
