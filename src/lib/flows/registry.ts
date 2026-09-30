/**
 * Combines every flow definition into one id-addressed step map, plus the resolutions
 * dictionary and the ticket-type → entry-step mapping.
 *
 * To add a new guided flow: create a file in src/lib/flows/definitions/, export its
 * steps and entry step id, then add both to the lists below.
 *
 * Answer text may use {{TERMS_URL}}, which is replaced with branding.websiteUrl.
 */

import { FlowStep, Resolution } from "./types";
import { billingSteps, BILLING_ROOT_ID, vipSteps } from "./definitions/billing";
import { partnershipsSteps, PARTNERSHIPS_ROOT_ID } from "./definitions/partnerships";
import { purchaseSteps } from "./definitions/purchase";
import { supportSteps, SUPPORT_ROOT_ID } from "./definitions/support";

const allSteps: FlowStep[] = [...billingSteps, ...vipSteps, ...purchaseSteps, ...partnershipsSteps, ...supportSteps];

export const STEP_MAP: Record<string, FlowStep> = Object.fromEntries(allSteps.map((s) => [s.id, s]));

/** Maps a ticket type's codeName to the id of its flow's first step. */
export const ENTRY_STEP_BY_TICKET_TYPE: Record<string, string> = {
	billing: BILLING_ROOT_ID,
	support: SUPPORT_ROOT_ID,
	partnerships: PARTNERSHIPS_ROOT_ID,
};

export function getEntryStepId(ticketTypeCodeName: string): string | undefined {
	return ENTRY_STEP_BY_TICKET_TYPE[ticketTypeCodeName];
}

export const RESOLUTIONS: Record<string, Resolution> = {
	vip_info: {
		key: "vip_info",
		title: "How VIP works",
		body:
			"VIP is our premium access tier — perks, access and billing for it are managed by our team. " +
			"For the full rundown, check {{TERMS_URL}}, or use **Talk to Staff** below if you'd like a team member to walk you through it.",
		autoEscalate: false,
	},
	need_help_deciding: {
		key: "need_help_deciding",
		title: "We'll help you decide",
		body: "No problem — our team can help you figure out the right direction. I've forwarded what you've shared so far so they can pick up from here.",
		autoEscalate: true,
	},
	refund_policy: {
		key: "refund_policy",
		title: "About your refund request",
		body:
			"We review every refund request individually per our terms of service ({{TERMS_URL}}). " +
			"I can't approve or deny a refund automatically here, so I've forwarded the details above to our team.",
		autoEscalate: true,
	},
	discount_notice: {
		key: "discount_notice",
		title: "About your discount / coupon",
		body: "I can't generate, verify, or apply discount codes automatically. I've forwarded the details above to our team so they can check it for you.",
		autoEscalate: true,
	},
	revision_policy: {
		key: "revision_policy",
		title: "About our revision policy",
		body: "Revision terms are outlined in our terms of service ({{TERMS_URL}}). I've forwarded your question to our team for a precise answer.",
		autoEscalate: true,
	},
	general_notice: {
		key: "general_notice",
		title: "Got it",
		body: "I don't want to guess on this one — I've forwarded your question to our team so they can give you an accurate answer.",
		autoEscalate: true,
	},
};
