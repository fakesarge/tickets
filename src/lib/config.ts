import fs from "fs-extra";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { BotConfig, ButtonStyleName } from "./types";

const SNOWFLAKE = /^\d{17,20}$/;
const BUTTON_STYLES: ButtonStyleName[] = ["Primary", "Secondary", "Success", "Danger"];

function requireSnowflake(value: string | undefined, label: string, errors: string[]): void {
	if (!value || !SNOWFLAKE.test(value)) errors.push(`${label} must be a valid Discord ID, got ${JSON.stringify(value)}`);
}

function optionalSnowflake(value: string | undefined, label: string, errors: string[]): void {
	if (value && !SNOWFLAKE.test(value)) errors.push(`${label} must be a valid Discord ID, got ${JSON.stringify(value)}`);
}

function snowflakeList(values: string[] | undefined, label: string, errors: string[]): void {
	for (const v of values ?? []) optionalSnowflake(v, label, errors);
}

/** Validates config shape and ID formats before the bot logs in, so a typo fails loudly at boot
 *  instead of as a generic error the first time a user hits the affected ticket type. */
export function loadConfig(): BotConfig {
	const file = path.join(__dirname, "../../config/config.jsonc");
	const raw = fs.readFileSync(file, "utf8");
	const config = parseJsonc(raw) as BotConfig;

	const errors: string[] = [];

	requireSnowflake(config.guildId, "guildId", errors);
	if (!config.branding?.name || !config.branding.websiteUrl) errors.push("branding.name and branding.websiteUrl are required");

	if (config.openTicketChannelId) optionalSnowflake(config.openTicketChannelId, "openTicketChannelId", errors);
	if (config.logs) requireSnowflake(config.logsChannelId, "logsChannelId (required when logs is true)", errors);
	else optionalSnowflake(config.logsChannelId, "logsChannelId", errors);

	snowflakeList(config.rolesWithTicketAccess, "rolesWithTicketAccess[]", errors);
	snowflakeList(config.rolesBlockedFromCreatingTickets, "rolesBlockedFromCreatingTickets[]", errors);
	snowflakeList(config.pingRolesOnOpen, "pingRolesOnOpen[]", errors);
	optionalSnowflake(config.claim?.moveToCategoryId, "claim.moveToCategoryId", errors);
	optionalSnowflake(config.close?.moveToCategoryId, "close.moveToCategoryId", errors);

	if (!Array.isArray(config.ticketTypes) || config.ticketTypes.length === 0) errors.push("at least one ticket type is required");
	if (config.ticketTypes?.length > 25) errors.push("a maximum of 25 ticket types is supported (Discord limit)");

	const seenCodeNames = new Set<string>();
	for (const t of config.ticketTypes ?? []) {
		const tag = `ticketTypes[codeName=${JSON.stringify(t.codeName)}]`;
		if (!t.codeName) errors.push(`${tag}: codeName is required`);
		else if (seenCodeNames.has(t.codeName)) errors.push(`${tag}: duplicate codeName`);
		else seenCodeNames.add(t.codeName);

		requireSnowflake(t.categoryId, `${tag}.categoryId`, errors);
		snowflakeList(t.staffRoleIds, `${tag}.staffRoleIds[]`, errors);
		snowflakeList(t.cantAccessRoleIds, `${tag}.cantAccessRoleIds[]`, errors);
		if (t.buttonStyle && !BUTTON_STYLES.includes(t.buttonStyle)) errors.push(`${tag}.buttonStyle must be one of ${BUTTON_STYLES.join(", ")}`);
		if (t.questions?.length > 5) errors.push(`${tag}.questions: at most 5 questions are supported`);
	}

	if (errors.length > 0) throw new Error(`config.jsonc is invalid:\n  - ${errors.join("\n  - ")}`);

	return config;
}
