import { ColorResolvable } from "discord.js";

export type TicketQuestion = {
	label: string;
	style: "SHORT" | "PARAGRAPH";
	placeholder?: string;
	maxLength?: number;
	required?: boolean;
};

export type ButtonStyleName = "Primary" | "Secondary" | "Success" | "Danger";

export type TicketType = {
	codeName: string;
	name: string;
	description: string;
	emoji?: string;
	/** Emoji and style used for this type's button on the ticket panel (falls back to `emoji` / Secondary). */
	buttonEmoji?: string;
	buttonStyle?: ButtonStyleName;
	color?: ColorResolvable;
	categoryId: string;
	ticketNameFormat: string;
	staffRoleIds: string[];
	cantAccessRoleIds: string[];
	/** Asked (signature + up to 4 of these) in the terms modal, once "Continue" → "Agree To Terms" is clicked. */
	questions: TicketQuestion[];
};

export type Branding = {
	name: string;
	websiteUrl: string;
	supportUrl?: string;
	colors: {
		/** The standalone "TICKET CENTER" select panel. */
		panel: string;
		/** Every other message: the per-ticket welcome panel, terms prompt/signed, guided-flow steps, staff takeover, close DM. */
		accent: string;
		/** The single "hand this off to staff" message. */
		escalation: string;
	};
	emojis: {
		bullet: string;
		relay: string;
		back: string;
		restart: string;
		talkToStaff: string;
		modalContinue: string;
		agent: string;
		resolved: string;
		escalation: string;
	};
	panel: {
		heading: string;
		subheading: string;
		notice: string;
		footer: string;
	};
};

export type BotConfig = {
	guildId: string;
	mainColor: ColorResolvable;
	branding: Branding;
	openTicketChannelId: string;
	logsChannelId: string;
	logs: boolean;
	ticketTypes: TicketType[];
	rolesWithTicketAccess: string[];
	rolesBlockedFromCreatingTickets: string[];
	maxOpenTicketsPerUser: number;
	/** Fallback staff role IDs pinged when a ticket escalates and its type has no staffRoleIds. */
	pingRolesOnOpen: string[];
	claim: {
		enabled: boolean;
		showButton: boolean;
		renameOnClaim?: string;
		moveToCategoryId?: string;
	};
	close: {
		onlyStaffCanClose: boolean;
		dmUserOnClose: boolean;
		createTranscript: boolean;
		deleteAfterCloseSeconds: number;
		moveToCategoryId?: string;
	};
	presence: {
		enabled: boolean;
		status: "online" | "idle" | "dnd" | "invisible";
		activityType: "PLAYING" | "LISTENING" | "WATCHING" | "COMPETING";
		activityText: string;
	};
};
