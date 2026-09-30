# discord-ticket-bot

A ticket bot for Discord built on discord.js v14, using **Components V2** for every
message it sends (panels, ticket messages, close notices), with a plug-and-play
command/event loader.

## Adding a command

Drop a file in `src/commands/` that default-exports a class extending `BaseCommand`
(see `src/commands/ping.ts` for a minimal example). It's automatically loaded and
registered as a slash command on startup — nothing else to wire up.

```ts
import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import BaseCommand from "../structure/BaseCommand";

export default class MyCommand extends BaseCommand {
	public static data = new SlashCommandBuilder().setName("hello").setDescription("Says hi");

	async execute(interaction: ChatInputCommandInteraction) {
		await interaction.reply("Hi!");
	}
}
```

## Adding an event

Drop a file in `src/events/` named after the discord.js event (e.g. `messageCreate.ts`)
that default-exports a class extending `BaseEvent`. It's automatically wired up on startup.

## What happens when someone opens a ticket

1. The panel button/select creates a private channel and sends **one** welcome-panel
   message (`src/ui/ticketPanel.ts`) — a banner, a short intro, and a **Continue** button.
2. **Continue** edits that same message in place into the Terms & Conditions prompt
   (`src/ui/terms.ts`) — **Agree To Terms** / **Decline Agreement**.
3. **Agree** opens a modal: a typed signature plus up to 4 of the ticket type's
   `questions` (billing gets its own fixed 3-field shape: purchase type, details, misc).
   On submit, the same message is edited again into a signed confirmation, and the
   `ticketCreate` log entry fires with the customer's answers. **Decline** deletes the
   ticket.
4. A **guided conversation flow** (see below) starts immediately in parallel, as its own
   message chain — it isn't gated on the terms being signed.

There is no separate "ticket opened" message showing the customer's answers — they only
ever appear in the log channel's `ticketCreate` entry. There's also no close button
anywhere; `/close reason:<text>` is the only way to close a ticket.

## Guided ticket flows

A decision tree of select menus / buttons / modals that walks the customer to the right
sub-topic before anything reaches staff.

- The customer's chat is locked to buttons/menus only until the flow either resolves
  the request automatically, hands off to staff (pinging `staffRoleIds` /
  `pingRolesOnOpen`), or a staff member claims the ticket — any of those unlock normal
  chat.
- Every step is rendered as a Components V2 message with **Back**, **Start Over**, and
  **Talk to Staff** always available.
- Escalating to staff edits that same flow message in place into one combined message
  (role ping + summary of every answer collected) — it doesn't send extra messages.
- `support`, `billing`, and `partnerships` ship with real flows in
  `src/lib/flows/definitions/`. Any other `codeName` just skips the flow (welcome panel →
  terms → done, no guided conversation).

**To add a flow for a new ticket type:**

1. Create `src/lib/flows/definitions/<name>.ts` exporting an array of steps (see
   `support.ts` for every step kind: `select`, `buttons`, `modal`) and an entry step id.
2. Register it in `src/lib/flows/registry.ts`: add its steps to `allSteps` and its
   `codeName → entry step id` mapping to `ENTRY_STEP_BY_TICKET_TYPE`.
3. Set that `codeName` on a ticket type in `config/config.jsonc`.

Each step's `goto` can point to another step id, `"@escalate"` (hand off to staff), or
`"@resolve:<key>"` (show a canned answer from `RESOLUTIONS` in `registry.ts`, optionally
auto-escalating after).

## Branding & design

Every colour, emoji, and piece of panel copy lives in the `branding` block of
`config/config.jsonc`, so the whole bot can be re-skinned without touching code:

- `branding.name` / `websiteUrl` / `supportUrl` — used in the terms message, "Website" buttons, DM notices, and `{{TERMS_URL}}` in flow answers
- `branding.colors` — `panel` (the TICKET CENTER select panel), `accent` (welcome panel, terms, guided-flow steps, staff takeover, close DM), and `escalation` (the staff hand-off message)
- `branding.emojis` — the custom bullet, relay, back/restart/talk-to-staff, and escalation emojis
- `branding.panel` — the TICKET CENTER panel's heading, subheading, notice, and footer
- `assets/logo.png` + `assets/banner.png` (TICKET CENTER panel), `assets/ticketwelcome.png` (per-ticket welcome banner, falls back to `banner.png`)
- Per ticket type: `buttonEmoji` / `buttonStyle` (the panel button), `emoji`, `color`, `questions`
- `src/ui/messages.ts` — every reply / notice string in one file

> **Custom emoji:** every `<:name:id>` emoji here only renders if the bot is a member of the server that
> owns it and has **Use External Emojis** in the channel — otherwise Discord shows the plain `:name:` text.

## Stripe (optional)

`/stripe connect` and `/stripe dashboard` show live account status, the last 7 days' net earnings, and the
incoming / available balances. Set `STRIPE_SECRET_KEY` in `.env` — a **restricted, read-only key** (Balance,
Balance transactions, Account) is all it needs. The command is administrator-only and replies ephemerally.

## Setup

1. **Create a Discord application** at https://discord.com/developers/applications,
   add a Bot user, and copy its token.
2. Under **Bot → Privileged Gateway Intents**, enable **Server Members Intent**. This is
   required — the bot requests it for role checks, and Discord rejects the login with
   "Used disallowed intents" if it's off.
3. Invite the bot to your server with the `bot` and `applications.commands` scopes and
   at minimum: Manage Channels, Manage Roles (channel-level), Send Messages, Read
   Message History, Attach Files, Manage Messages.
4. Copy `.env.example` to `.env` and fill in `TOKEN`.
5. Edit `config/config.jsonc`:
   - `guildId` — your server's ID
   - `openTicketChannelId` — where the ticket panel is posted
   - `logsChannelId` — where ticket events + transcripts are logged
   - `ticketTypes[].categoryId` — the category each ticket type's channels are created under
   - `rolesWithTicketAccess` — your staff role IDs
6. Install, set up the database, build, and run:

```bash
npm install
npm run setup   # npm install + prisma db push (creates prisma/dev.db)
npm run build
npm start
```

For local development with auto-reload: `npm run dev`.

## What's here vs. the reference bot

This mirrors the current design of the reference ticket bot this was built from — its panel layout,
custom emojis, colors, the single welcome-panel-into-terms flow, and guided conversations — rebuilt with
a plug-and-play command/event loader. Two things were deliberately **not** carried over:

- **Transcripts are generated locally** as a plain HTML file attached to your logs channel — nothing is
  uploaded to any third-party transcript service.
- **No telemetry or phone-home** of any kind (no outbound websocket, no anonymous usage reporting).

The custom emojis (`<:purplebullet:…>`, `<:relay:…>`, etc.) belong to the reference bot's server — they'll
only render here if this bot is also a member of that server. Swap them for your own in
`branding.emojis` / `src/lib/flows/definitions/*.ts` otherwise.
