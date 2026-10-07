/** All user-facing copy for replies and notices lives here so it can be edited in one place. */

export const MSG = {
	commandError: "There was an error while executing this command!",
	notTicketChannel: "This command can only be used in a ticket channel.",
	ticketNotFound: "Ticket not found",

	ticketOpened: (channelId: string) => `Ticket opened! <#${channelId}>`,
	alreadyCreating: "You're already creating a ticket — hang tight.",
	blacklisted: "You can't create a ticket because you are blacklisted",
	typeUnavailable: "This ticket type is not available.",
	typeBlockedForRoles: "You cannot open this ticket type with your current roles.",
	ticketLimit: (limit: number) => `You can only have ${limit} tickets opened at the same time!`,
	invalidConfig: "Invalid configuration detected, please ask the bot operator to fix it!",
	noCategory: (typeName: string) => `Ticket type "${typeName}" has no categoryId configured — ask an admin to set one in config.jsonc.`,

	claimOnlyStaff: "The ticket can only be claimed by a staff!",
	alreadyClaimed: "The ticket is already claimed!",
	claimDisabled: "Claiming is disabled.",
	claimed: (userId: string) => `> Ticket claimed by <@${userId}>`,
	claimedBy: (userId: string) => `**Claimed By**: <@${userId}>`,

	closeOnlyStaff: "Only staff can close the ticket!",
	alreadyClosed: "The ticket is already closed!",
	creatingTranscript: "> Creating transcript...",
	transcriptCreated: (logsChannelId?: string) => (logsChannelId ? `> Transcript created! Saved to <#${logsChannelId}>` : "> Transcript created!"),
	transcriptUnavailable: "Unavailable",
	noReasonGiven: "No reason given",
	deleteInfo: (seconds: number) => `> The ticket will be deleted in ${seconds} seconds`,
	deleteButton: "Delete ticket",
	closedTitle: "Ticket closed",
	closedBody: (closer: string, reason: string) => `The ticket has been closed by ${closer} with the following reason: \`${reason}\``,

	renameOnlyStaff: "Only staff can rename tickets!",
	renamed: (channelMention: string) => `> Ticket renamed to ${channelMention}`,

	userAdded: (userId: string) => `> Added <@${userId}> to the ticket`,
	userAlreadyAdded: "User already added",
	tooManyUsers: "You can't add more than 25 users",
	usersRemoved: (ids: string[]) => `> Removed ${ids.map((a) => `<@${a}>`).join(", ")} from the ticket`,
	noUsersToRemove: "There are no users to remove",
	removePlaceholder: "Please select a user to remove",
	needAtLeastOneUser: "You need to specify at least one user",
	massAddDone:
		"> Mass User Add Completed! Do note that not all users may be added if internal checks failed. It's advise you use the regular add command to guarantee the add status.",
	dmCleared: "Cleared all of your DM history",

	termsOwnerOnlyAccept: "Only the ticket owner can accept the terms.",
	termsOwnerOnlyDecline: "Only the ticket owner can decline.",
	termsNotLinked: "Terms message is not linked to this ticket.",
	termsInvalidConfig: "Invalid ticket configuration.",
	termsDeclined: "You declined the terms. This ticket has been closed.",
	termsNotOwner: "Ticket not found or you are not the ticket owner.",
	termsNoStep: "This ticket has no terms step recorded.",
	termsAccepted: "Terms accepted — your ticket is ready. Thank you!",

	adminOnly: "Only admins can use that.",
	ordersNotConfigured: "Orders aren't connected yet — an admin needs to set `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `BOT_API_SECRET` in the bot's .env.",
	orderNotFound: "I couldn't find that order.",
	ordersLookupFailed: "Something went wrong looking that up. Please try again in a moment.",
	orderOwnOnly: "You can only view your own orders.",
	vipRevoked: (userId: string) => `> Removed VIP from <@${userId}>`,
	vipNotFound: (userId: string) => `<@${userId}> doesn't have a VIP record.`,
	vipOwnOnly: "You can only check your own VIP.",

	flowStaffHandling: "A staff member is already handling this ticket.",
	flowModalAck: "Got it — thanks!",
};
