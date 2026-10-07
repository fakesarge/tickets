import { config as loadEnv } from "dotenv";
loadEnv();

import { GatewayIntentBits } from "discord.js";
import ExtendedClient from "./structure/ExtendedClient";
import { loadConfig } from "./lib/config";
import { initTheme } from "./ui/theme";

process.on("unhandledRejection", (reason) => console.error("Unhandled rejection:", reason));
process.on("uncaughtException", (err) => console.error("Uncaught exception:", err));

const token = process.env["TOKEN"];
if (!token || !token.trim()) throw new Error("TOKEN environment variable is required (see .env.example)");

const config = loadConfig();
initTheme(config.branding);

// Presence is a privileged intent: it's only requested when the shop-status board is set up to show live activity,
// and it must also be switched on in the Developer Portal (Bot → Privileged Gateway Intents → Presence Intent).
const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers];
if (config.shopStatus?.channelId && config.shopStatus.trackPresence !== false) intents.push(GatewayIntentBits.GuildPresences);

const client = new ExtendedClient({ intents }, config);

client.loadCommands();
client.loadEvents();

client.login(token).catch((err) => {
	console.error("Failed to log in:", err);
	process.exit(1);
});
