import { Client, ClientOptions, Collection, REST, Routes } from "discord.js";
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import BaseCommand, { CommandData } from "./BaseCommand";
import BaseEvent from "./BaseEvent";
import { BotConfig } from "../lib/types";

type CommandCtor = { data: CommandData } & (new (client: ExtendedClient) => BaseCommand);
type EventCtor = new (client: ExtendedClient) => BaseEvent;

export default class ExtendedClient extends Client {
	public readonly config: BotConfig;
	public readonly prisma: PrismaClient;
	public readonly commands = new Collection<string, BaseCommand>();

	constructor(options: ClientOptions, config: BotConfig) {
		super(options);
		this.config = config;
		this.prisma = new PrismaClient({ errorFormat: "minimal" });
	}

	/** Reads every .ts/.js file in a directory and returns its default export. */
	private loadDefaultExports(dir: string): unknown[] {
		if (!fs.existsSync(dir)) return [];
		return fs
			.readdirSync(dir)
			.filter((f) => (f.endsWith(".ts") || f.endsWith(".js")) && !f.endsWith(".d.ts"))
			.map((f) => {
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				const mod = require(path.join(dir, f));
				return { file: f, exported: mod.default };
			})
			.filter((x) => typeof x.exported === "function");
	}

	public loadCommands(): void {
		const dir = path.join(__dirname, "../commands");
		for (const { exported } of this.loadDefaultExports(dir) as { file: string; exported: CommandCtor }[]) {
			const instance = new exported(this);
			this.commands.set(exported.data.name, instance);
		}
		console.log(`Loaded ${this.commands.size} command(s): ${[...this.commands.keys()].join(", ")}`);
	}

	public loadEvents(): void {
		const dir = path.join(__dirname, "../events");
		for (const { file, exported } of this.loadDefaultExports(dir) as { file: string; exported: EventCtor }[]) {
			const eventName = path.basename(file).replace(/\.(ts|js)$/, "");
			const instance = new exported(this);
			this.on(eventName, (...args: unknown[]) => {
				Promise.resolve(instance.execute(...args)).catch((err) =>
					console.error(`Error in event "${eventName}":`, err)
				);
			});
		}
		console.log("Loaded events.");
	}

	public async deployCommands(): Promise<void> {
		const token = process.env["TOKEN"];
		if (!token) throw new Error("TOKEN environment variable is required to deploy commands");
		if (!this.user) throw new Error("Client must be logged in before deploying commands");

		const body = [...this.commands.values()].map((c) => (c.constructor as typeof BaseCommand).data.toJSON());
		const rest = new REST({ version: "10" }).setToken(token);

		try {
			await rest.put(Routes.applicationGuildCommands(this.user.id, this.config.guildId), { body });
			console.log(`Registered ${body.length} slash command(s) for guild ${this.config.guildId}.`);
		} catch (err) {
			console.error("Failed to register slash commands:", err);
		}
	}
}
