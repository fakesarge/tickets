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

## Orders (linked to the website's Supabase)

`/order` reads and writes the same `orders` table the website dashboard uses, so changes show up in the
customer's dashboard and trigger the site's existing order notifications.

| Command | Who | What it does |
| --- | --- | --- |
| `/order list` | anyone | Your own orders and their status. Admins can add `user:` to see someone else's. |
| `/order view` | anyone | One order in full (autocomplete lists your orders). Customers can only open their own. |
| `/order add` | admin | Creates an order for a customer: `user`, `name`, `price`, optional `category`, `service`, `description`. |
| `/order edit` | admin | Change an order's name, price, category, service, or description. |
| `/order status` | admin | Set `pending`, `in_progress`, `completed`, or `cancelled`. |

- Customers are matched by `orders.discord_id`. `/order add` needs the customer to have linked their Discord on the
  website (it fills the order's required email/name from their profile) — same rule as the website's own order form.
- The database only accepts the categories `gfx` / `vfx` / `template` and the four statuses above, so the commands offer exactly those.
- **Status DMs:** when an admin changes an order's status with `/order status`, the customer gets a DM showing the old
  and new status (with Website / Tickets buttons). The admin's reply says whether it was delivered. Only status changes
  DM — editing a name or price doesn't, and setting the same status again does nothing. Customers with DMs closed
  don't block the update. Changes made directly in the website dashboard don't go through the bot, so they don't DM.
- Replies are private (ephemeral) because they contain customer data.

**How it's connected (no server to host):** the bot talks to Supabase directly, but never with the service-role key.
`supabase/bot-orders.sql` adds five small database functions (`bot_orders_list/get/search/create/update`). The bot
calls them through Supabase's built-in API using the project's *public* anon key plus its own `BOT_API_SECRET`; each
function checks that secret (stored only as a SHA-256 hash) before doing anything. The anon role has no access to the
tables themselves, so even if the bot's `.env` leaked, all anyone could do is list/read/create/edit orders — no
deleting, no customer emails or referral codes in any response, nothing outside `orders`. To cut the bot off,
run `delete from bot_private.credentials;` in the SQL editor.

**Setup (once):**

1. In `.env` set `SUPABASE_URL`, `SUPABASE_ANON_KEY` (the public key) and `BOT_API_SECRET` (any long random string).
2. Supabase dashboard → **SQL Editor** → paste and run `supabase/bot-orders.sql`.
3. Run `npm run -s orders:secret` and paste the SQL it prints into the SQL Editor too (it contains only a hash of your secret).
4. Restart the bot. Without these settings the bot runs normally and `/order` just says orders aren't connected.

## VIP

VIP is tracked in the bot's own database (not Supabase); admins set the expiry.

| Command | Who | What it does |
| --- | --- | --- |
| `/vip give user: expires:` | admin | Grants VIP, or changes the expiry. `expires` is a date (`2026-12-31`, end of that day UTC) or a length (`30d`, `4w`). |
| `/vip check` | anyone | Shows your VIP status and expiration date. Admins can add `user:`. |
| `/vip revoke user:` | admin | Removes someone's VIP. |
| `/vip list` | admin | Everyone with active VIP, soonest-expiring first. |

**Expiry reminder:** the bot DMs each VIP member once, 7 days before their VIP ends (checked on startup and hourly, so
a restart doesn't miss anyone). Changing someone's expiry re-arms the reminder; granting a date that's already within
7 days doesn't send an instant "expiring soon" DM. Members with DMs closed are skipped quietly.

**Who is an admin:** members with the Discord **Administrator** permission, plus any role IDs in `adminRoleIds` in
`config/config.jsonc`.

## Affiliates (creator codes)

Like a Fortnite creator code: admins create affiliates, members enter a code to support one, and affiliates track
their stats and withdraw their balance. It lives entirely in the bot's own database (four plain tables —
`affiliates`, `affiliateReferrals`, `affiliateWithdrawals`, `affiliateLedger`) and has nothing to do with Supabase or `/order`.
Balances are managed by admins; money is stored as whole cents.

**Members**

| Command | What it does |
| --- | --- |
| `/code use code:` | Support a creator with their code (autocompletes). **Posted publicly** with a "Use code" button so others can follow. Using a new code switches to it; you can't use your own. The creator gets a DM. |
| `/code view` | **Public** card showing who you're supporting (private if you aren't using a code). |
| `/code clear` | Stop using your code (private). |

**Affiliates** (must be in the affiliate database, and have the `affiliate.roleId` role if one is set).
Everything here is **public by default** so affiliates can show off; failed attempts are always private.

| Command | What it does |
| --- | --- |
| `/affiliate share` | Posts your code with supporter count and a "Use code" button. Never shows money. |
| `/affiliate me` | Your code, referrals, balance and progress toward the minimum withdrawal. Add `private:true` to hide it. |
| `/affiliate stats` | The above plus rank and recent activity. Supports `private:true`. |
| `/affiliate withdraw payout: [amount:]` | Requests a payout (empty `amount` = everything), shown publicly **without** the payout details — only staff see those. The amount is set aside immediately, one request at a time. |
| `/affiliate history` | Your balance activity and past withdrawals. Supports `private:true`. |

**Admins** (`/affiliate admin …`)

| Command | What it does |
| --- | --- |
| `create user [code]` | Makes someone an affiliate and gives them `affiliate.roleId`. Code defaults to their username. |
| `remove user` | Removes them (and the role); anyone using their code is detached. Blocked while a withdrawal is pending. |
| `setcode user code` | Changes their code. |
| `balance user action amount [note]` | **Add earnings** (balance and lifetime earnings up), **Remove** (clawback, both down), or **Set** the balance exactly (earnings untouched). The affiliate gets a DM. |
| `view user` | Everything about one affiliate: stats, rank, latest referrals, ledger, withdrawals. |
| `list` | All affiliates, top earners first. |
| `payouts` | Withdrawals waiting for approval. |
| `approve id [note]` / `reject id [reason]` | Mark a withdrawal paid, or reject it and refund the balance. The affiliate gets a DM. |
| `export` | CSV files of all four tables (open in Excel or Google Sheets). |

**Withdrawals:** if `affiliate.payoutChannelId` is set, each request is posted there with **Mark as paid** / **Reject & refund**
buttons (admins only). Without it, use `/affiliate admin payouts`. Pay the person yourself (PayPal, etc.) and then mark it paid —
the bot only does the bookkeeping. Set `affiliate.minWithdrawalUsd` for the smallest request allowed (default $10).

Setup: create an "Affiliate" role, put its ID in `affiliate.roleId` (optional), and run `npm run setup` once so the new tables exist.

## Shop status board (`/shop`)

A public status board for the whole store, posted in the channel set by `shopStatus.channelId` in `config/config.jsonc`.
It is **one message that's edited in place**, plus a short "what changed" announcement each time something important
changes.

| Command | Who | What it does |
| --- | --- | --- |
| `/shop open [note]` | admin | Store open. Announces it (pings `pingRoleId` if set). |
| `/shop close [reason]` | admin | "Closed for today", with an optional reason / when you're back. |
| `/shop queue level:` | admin | Queue **low / medium / high / full** (or hide it). |
| `/shop sale state: [name] [details] [ends]` | admin | Sale **started**, **ending soon**, or **ended**. `ends` is a date (`2026-12-31`) or length (`3d`); the sale ends itself automatically at that time. |
| `/shop note [text]` | admin | A short line on the board (no announcement). Leave empty to clear. |
| `/shop announce message:` | admin | A one-off announcement. |
| `/shop track user:` / `untrack` / `tracking` | admin | Whose live activity the board shows. |
| `/shop refresh` | admin | Update the board now (re-posts it if it was deleted). |
| `/shop view` | anyone | See the current status privately. |

**Live activity ("working in Photoshop"):** the board reads the Discord presence of the people you add with
`/shop track` and shows lines like *🎨 @you is working in **Photoshop*** or their custom status text. Updates are
debounced and edit the board at most every ~30 seconds.

- Only the **app name** is shown — never the file/project name from rich presence, which could reveal a customer's work.
- Only creative apps (Photoshop, After Effects, Premiere, Illustrator, Lightroom, Blender, Cinema 4D, DaVinci Resolve,
  Figma, Substance, Maya, 3ds Max, Affinity, Krita) and custom-status text are shown. Games, Spotify, etc. are ignored
  unless `shopStatus.showOtherActivities` is `true`.
- Custom-status text is public on the board once you track someone, so only track people who are fine with that.
- **Requires the Presence Intent:** Developer Portal → your app → **Bot → Privileged Gateway Intents → Presence Intent**
  must be on, otherwise the bot fails to log in with "Used disallowed intents". To run without it, set
  `shopStatus.trackPresence` to `false` (everything else still works).
- The bot needs **View Channel, Send Messages, and Embed Links** in the status channel.

## Setup

1. **Create a Discord application** at https://discord.com/developers/applications,
   add a Bot user, and copy its token.
2. Under **Bot → Privileged Gateway Intents**, enable **Server Members Intent** (and **Presence Intent** if you use the
   shop status board's live activity). Server Members is required — the bot requests it for role checks, and Discord rejects the login with
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
