// Prints the SQL that registers BOT_API_SECRET with your Supabase database.
// Only a SHA-256 hash is printed — the secret itself never leaves your .env.
require("dotenv").config();
const crypto = require("crypto");

const secret = process.env.BOT_API_SECRET?.trim();
if (!secret || secret.length < 32) {
	console.error("Set BOT_API_SECRET in .env first (at least 32 characters). Generate one with:  openssl rand -hex 32");
	process.exit(1);
}

const hash = crypto.createHash("sha256").update(secret).digest("hex");
console.log(`-- Run this once in the Supabase SQL Editor (after supabase/bot-orders.sql). Re-run it to rotate the secret.
insert into bot_private.credentials (id, secret_hash)
values (1, decode('${hash}', 'hex'))
on conflict (id) do update set secret_hash = excluded.secret_hash;`);
