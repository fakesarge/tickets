import {
	AutocompleteInteraction,
	ChatInputCommandInteraction,
	SlashCommandBuilder,
	SlashCommandOptionsOnlyBuilder,
	SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";
import type ExtendedClient from "./ExtendedClient";

export type CommandData =
	| SlashCommandBuilder
	| SlashCommandOptionsOnlyBuilder
	| SlashCommandSubcommandsOnlyBuilder;

/**
 * Drop a new file in src/commands/ that default-exports a class extending this,
 * and it is auto-loaded and auto-registered — nothing else to wire up.
 */
export default abstract class BaseCommand {
	public static data: CommandData;

	protected client: ExtendedClient;

	constructor(client: ExtendedClient) {
		this.client = client;
	}

	abstract execute(interaction: ChatInputCommandInteraction): unknown | Promise<unknown>;

	/** Optional: answer autocomplete for any option marked `.setAutocomplete(true)` on this command. */
	autocomplete?(interaction: AutocompleteInteraction): unknown | Promise<unknown>;
}
