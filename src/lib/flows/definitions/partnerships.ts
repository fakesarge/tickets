/* Partnerships ticket-type flow. Light classification — the terms intake modal already collected a free-text description, so we just categorize and hand off. */

import { FlowStep } from "../types";
import { select } from "../helpers";

export const PARTNERSHIPS_ROOT_ID = "partnerships_root";

export const partnershipsSteps: FlowStep[] = [
	select(
		PARTNERSHIPS_ROOT_ID,
		"What type of partnership is this?",
		"Select the option that best describes your request — our team will follow up.",
		[
			{ value: "sponsorship", label: "Sponsorship", emoji: "<:249884cash:1549829672995651604>", goto: "@escalate" },
			{ value: "collaboration", label: "Collaboration", emoji: "<:41158gang:1322304696492232746>", goto: "@escalate" },
			{ value: "reseller", label: "Reseller / Affiliate", emoji: "<:249884cash:1549829672995651604>", goto: "@escalate" },
			{ value: "other", label: "Other", emoji: "<:685951info:1549829734416781353>", goto: "@escalate" },
		],
		"Select a category"
	),
];
