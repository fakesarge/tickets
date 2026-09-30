import type ExtendedClient from "./ExtendedClient";

/**
 * Drop a new file in src/events/ that default-exports a class extending this,
 * name the file after the Discord.js event it listens to (e.g. `messageCreate.ts`
 * for the `messageCreate` event), and it is auto-loaded — nothing else to wire up.
 */
export default abstract class BaseEvent {
	protected client: ExtendedClient;

	constructor(client: ExtendedClient) {
		this.client = client;
	}

	abstract execute(...args: unknown[]): unknown | Promise<unknown>;
}
