import path from "node:path";
import { MessageFlags } from "discord.js";
import { Branding } from "../lib/types";

let current: Branding | undefined;

export function initTheme(branding: Branding): void {
	current = branding;
}

export function brand(): Branding {
	if (!current) throw new Error("Theme accessed before initTheme() was called");
	return current;
}

/** Folder holding the panel images (logo.png, banner.png). Works from both src/ and dist/. */
export const ASSETS_DIR = path.join(__dirname, "../../assets");

/** Discord's Components V2 messages can't use `content`, so role pings live inside the text display. */
export function pingLine(roleIds: string[]): string {
	return roleIds.map((r) => `<@&${r}>`).join(" ");
}

/** Zero-width left-to-right mark used in the original designs to force blank lines / spacing. */
export const LRM = "‎";


/** Components V2 message visible only to the person who ran the command. */
export const V2_EPHEMERAL = (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
