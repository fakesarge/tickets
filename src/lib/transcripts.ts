import { AttachmentBuilder, ChannelType, Message, TextChannel } from "discord.js";
import ExtendedClient from "../structure/ExtendedClient";

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

async function fetchAllMessages(channel: TextChannel): Promise<Message[]> {
	const all: Message[] = [];
	let before: string | undefined;

	while (true) {
		const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
		if (batch.size === 0) break;
		all.push(...batch.values());
		before = batch.last()?.id;
		if (batch.size < 100) break;
	}

	return all.reverse();
}

function renderHtml(channel: TextChannel, messages: Message[], ticketNumber: number): string {
	const rows = messages
		.map((m) => {
			const time = new Date(m.createdTimestamp).toLocaleString("en-US", { timeZone: "UTC" });
			const content = escapeHtml(m.content || "*[no text content]*").replace(/\n/g, "<br>");
			const attachments = m.attachments.size
				? `<div class="attachments">${[...m.attachments.values()].map((a) => `📎 <a href="${escapeHtml(a.url)}">${escapeHtml(a.name ?? "attachment")}</a>`).join("<br>")}</div>`
				: "";
			return `<div class="message">
	<div class="meta"><strong>${escapeHtml(m.author.tag)}</strong> <span class="time">${time} UTC</span></div>
	<div class="content">${content}</div>
	${attachments}
</div>`;
		})
		.join("\n");

	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Ticket #${ticketNumber} transcript</title>
<style>
	body { background:#313338; color:#dbdee1; font-family: system-ui, sans-serif; margin:0; padding:24px; }
	h1 { color:#f2f3f5; font-size:20px; }
	.message { padding:10px 0; border-bottom:1px solid #3f4147; }
	.meta { color:#f2f3f5; margin-bottom:4px; }
	.time { color:#949ba4; font-size:12px; margin-left:8px; }
	.content { white-space: pre-wrap; word-break: break-word; }
	.attachments { margin-top:4px; font-size:14px; }
	a { color:#00a8fc; }
</style>
</head>
<body>
<h1>Transcript — #${escapeHtml(channel.name)} (ticket #${ticketNumber})</h1>
${rows || "<p><em>No messages.</em></p>"}
</body>
</html>`;
}

/**
 * Generates a plain HTML transcript of a ticket channel and drops it in the logs channel.
 * Everything stays on your own server — no third-party upload, no external requests.
 */
export async function postTranscript(client: ExtendedClient, channel: TextChannel, ticketNumber: number): Promise<void> {
	if (!client.config.close.createTranscript) return;
	if (!client.config.logsChannelId) return;

	const logsChannel = await client.channels.fetch(client.config.logsChannelId).catch(() => null);
	if (!logsChannel || logsChannel.type !== ChannelType.GuildText) return;

	const messages = await fetchAllMessages(channel);
	const html = renderHtml(channel, messages, ticketNumber);
	const attachment = new AttachmentBuilder(Buffer.from(html, "utf8"), { name: `ticket-${ticketNumber}.html` });

	await (logsChannel as TextChannel)
		.send({ content: `Transcript for ticket #${ticketNumber}`, files: [attachment] })
		.catch((e) => console.error("Failed to post transcript:", e));
}
