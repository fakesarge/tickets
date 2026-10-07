-- Discord ticket bot -> orders, using only Supabase itself (no edge function, nothing to host).
--
-- Run this whole file once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- It is safe to re-run (it replaces the functions; the secret is untouched).
-- Then run supabase/bot-orders-secret.sql once to register the bot's secret.
--
-- How it keeps the bot away from the rest of your data:
--   * The bot uses the PUBLIC anon key (the same one the website ships to browsers) + its own BOT_API_SECRET.
--     It never holds the service-role key.
--   * The anon role has no access to the tables. The only things it can do are call the five functions
--     below, and each one checks the secret first (compared as a SHA-256 hash; the secret itself is never stored).
--   * The functions can: list / get / search / create / update orders. They cannot delete anything, never
--     return customer_email or referral_code, and never touch profiles, roles, VIP, storage or auth.
--   * To revoke the bot's access at any time:  delete from bot_private.credentials;

create schema if not exists bot_private;
revoke all on schema bot_private from public, anon, authenticated;

create table if not exists bot_private.credentials (
  id int primary key default 1 check (id = 1),
  secret_hash bytea not null
);
alter table bot_private.credentials enable row level security; -- no policies: unreadable through the API
revoke all on bot_private.credentials from public, anon, authenticated;

-- ── internal helpers (not callable through the API: bot_private isn't exposed) ─────────────────────

create or replace function bot_private.verify(p_secret text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_secret is not null
     and length(p_secret) >= 32
     and exists (
       select 1 from bot_private.credentials
       where secret_hash = sha256(convert_to(p_secret, 'utf8'))
     );
$$;

create or replace function bot_private.fail(p_code text, p_message text) returns jsonb
language sql immutable set search_path = ''
as $$ select jsonb_build_object('ok', false, 'error', jsonb_build_object('code', p_code, 'message', p_message)); $$;

create or replace function bot_private.done(p_data jsonb) returns jsonb
language sql immutable set search_path = ''
as $$ select jsonb_build_object('ok', true, 'data', p_data); $$;

-- The only columns that ever leave the database. customer_email and referral_code are deliberately absent.
create or replace function bot_private.order_json(o public.orders) returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'order_code',    o.order_code,
    'order_name',    o.order_name,
    'customer_name', o.customer_name,
    'service',       o.service,
    'category',      o.category,
    'price',         o.price,
    'description',   o.description,
    'status',        o.status,
    'discord_id',    o.discord_id,
    'created_at',    o.created_at,
    'updated_at',    o.updated_at
  );
$$;

-- ── the API ──────────────────────────────────────────────────────────────────────────────────────

-- A customer's orders, newest first.
create or replace function public.bot_orders_list(p_secret text, p_discord_id text, p_limit int default 25)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare result jsonb;
begin
  if not bot_private.verify(p_secret) then return bot_private.fail('UNAUTHORIZED', 'Unauthorized.'); end if;
  if p_discord_id is null or p_discord_id !~ '^\d{15,25}$' then return bot_private.fail('BAD_REQUEST', 'discord_id must be a Discord user ID'); end if;
  if p_limit is null or p_limit < 1 or p_limit > 25 then return bot_private.fail('BAD_REQUEST', 'limit must be a whole number from 1 to 25'); end if;

  select coalesce(jsonb_agg(bot_private.order_json(o) order by o.created_at desc), '[]'::jsonb) into result
  from (select * from public.orders where discord_id = p_discord_id order by created_at desc limit p_limit) o;
  return bot_private.done(result);
end $$;

-- One order, or null. Pass p_owner_discord_id to only match that customer's own order.
create or replace function public.bot_orders_get(p_secret text, p_order_code text, p_owner_discord_id text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare o public.orders;
begin
  if not bot_private.verify(p_secret) then return bot_private.fail('UNAUTHORIZED', 'Unauthorized.'); end if;
  if p_order_code is null or btrim(p_order_code) !~ '^[A-Za-z0-9_-]{3,40}$' then return bot_private.fail('BAD_REQUEST', 'order_code is not valid'); end if;
  if p_owner_discord_id is not null and p_owner_discord_id !~ '^\d{15,25}$' then return bot_private.fail('BAD_REQUEST', 'discord_id must be a Discord user ID'); end if;

  select * into o from public.orders
  where order_code = btrim(p_order_code) and (p_owner_discord_id is null or discord_id = p_owner_discord_id)
  limit 1;
  if not found then return bot_private.done(null); end if;
  return bot_private.done(bot_private.order_json(o));
end $$;

-- Up to 25 orders matching a code or name (and the customer's name when not scoped to one owner).
create or replace function public.bot_orders_search(p_secret text, p_term text default '', p_owner_discord_id text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  result jsonb;
  pattern text;
begin
  if not bot_private.verify(p_secret) then return bot_private.fail('UNAUTHORIZED', 'Unauthorized.'); end if;
  if p_owner_discord_id is not null and p_owner_discord_id !~ '^\d{15,25}$' then return bot_private.fail('BAD_REQUEST', 'discord_id must be a Discord user ID'); end if;

  -- Escape LIKE wildcards so the term is matched literally.
  pattern := '%' || replace(replace(replace(left(btrim(coalesce(p_term, '')), 40), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  select coalesce(jsonb_agg(bot_private.order_json(o) order by o.created_at desc), '[]'::jsonb) into result
  from (
    select * from public.orders
    where (p_owner_discord_id is null or discord_id = p_owner_discord_id)
      and (order_code ilike pattern or order_name ilike pattern or (p_owner_discord_id is null and customer_name ilike pattern))
    order by created_at desc
    limit 25
  ) o;
  return bot_private.done(result);
end $$;

-- Creates an order for a customer who has linked Discord on the website (that profile supplies the required email).
create or replace function public.bot_orders_create(
  p_secret text, p_discord_id text, p_discord_username text, p_order_name text, p_price numeric,
  p_category text, p_service text default null, p_description text default null
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  prof record;
  o public.orders;
  v_name text := btrim(coalesce(p_order_name, ''));
  v_service text := nullif(btrim(coalesce(p_service, '')), '');
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if not bot_private.verify(p_secret) then return bot_private.fail('UNAUTHORIZED', 'Unauthorized.'); end if;
  if p_discord_id is null or p_discord_id !~ '^\d{15,25}$' then return bot_private.fail('BAD_REQUEST', 'discord_id must be a Discord user ID'); end if;
  if v_name = '' or char_length(v_name) > 100 then return bot_private.fail('BAD_REQUEST', 'order_name must be 1-100 characters'); end if;
  if p_price is null or p_price < 0.01 or p_price > 99999999.99 then return bot_private.fail('BAD_REQUEST', 'price must be between 0.01 and 99,999,999.99'); end if;
  if p_category is null or p_category not in ('gfx', 'vfx', 'template') then return bot_private.fail('BAD_REQUEST', 'category must be one of: gfx, vfx, template'); end if;
  if char_length(coalesce(v_service, '')) > 100 then return bot_private.fail('BAD_REQUEST', 'service is too long (max 100 characters)'); end if;
  if char_length(coalesce(v_desc, '')) > 1000 then return bot_private.fail('BAD_REQUEST', 'description is too long (max 1000 characters)'); end if;

  select username, email into prof from public.profiles where discord_id = p_discord_id limit 1;
  if not found or prof.email is null or btrim(prof.email) = '' then
    return bot_private.fail('NO_PROFILE', 'That customer hasn''t linked their Discord to a website account (or has no email on it), so there''s nothing to attach the order to.');
  end if;

  insert into public.orders (order_name, price, category, service, description, customer_name, customer_email, discord_id, status)
  values (
    v_name, round(p_price, 2), p_category, coalesce(v_service, v_name), v_desc,
    coalesce(nullif(prof.username, ''), nullif(btrim(coalesce(p_discord_username, '')), ''), 'Customer'),
    prof.email, p_discord_id, 'pending'
  )
  returning * into o;
  return bot_private.done(bot_private.order_json(o));
end $$;

-- Edits an order. p_patch may contain: order_name, price, category, service, description, status.
create or replace function public.bot_orders_update(p_secret text, p_order_code text, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  k text;
  o public.orders;
  v_name text; v_price numeric; v_category text; v_service text; v_desc text; v_status text;
begin
  if not bot_private.verify(p_secret) then return bot_private.fail('UNAUTHORIZED', 'Unauthorized.'); end if;
  if p_order_code is null or btrim(p_order_code) !~ '^[A-Za-z0-9_-]{3,40}$' then return bot_private.fail('BAD_REQUEST', 'order_code is not valid'); end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then return bot_private.fail('BAD_REQUEST', 'patch must be an object'); end if;
  if p_patch = '{}'::jsonb then return bot_private.fail('BAD_REQUEST', 'Nothing to update - provide at least one field'); end if;

  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('order_name', 'price', 'category', 'service', 'description', 'status') then
      return bot_private.fail('BAD_REQUEST', 'Unknown field: ' || left(k, 40));
    end if;
  end loop;

  if p_patch ? 'order_name' then
    if jsonb_typeof(p_patch -> 'order_name') <> 'string' then return bot_private.fail('BAD_REQUEST', 'order_name must be text'); end if;
    v_name := btrim(p_patch ->> 'order_name');
    if v_name = '' or char_length(v_name) > 100 then return bot_private.fail('BAD_REQUEST', 'order_name must be 1-100 characters'); end if;
  end if;
  if p_patch ? 'price' then
    if jsonb_typeof(p_patch -> 'price') <> 'number' then return bot_private.fail('BAD_REQUEST', 'price must be a number'); end if;
    v_price := (p_patch ->> 'price')::numeric;
    if v_price < 0.01 or v_price > 99999999.99 then return bot_private.fail('BAD_REQUEST', 'price must be between 0.01 and 99,999,999.99'); end if;
    v_price := round(v_price, 2);
  end if;
  if p_patch ? 'category' then
    v_category := p_patch ->> 'category';
    if jsonb_typeof(p_patch -> 'category') <> 'string' or v_category not in ('gfx', 'vfx', 'template') then return bot_private.fail('BAD_REQUEST', 'category must be one of: gfx, vfx, template'); end if;
  end if;
  if p_patch ? 'service' then
    if jsonb_typeof(p_patch -> 'service') <> 'string' then return bot_private.fail('BAD_REQUEST', 'service must be text'); end if;
    v_service := btrim(p_patch ->> 'service');
    if v_service = '' or char_length(v_service) > 100 then return bot_private.fail('BAD_REQUEST', 'service must be 1-100 characters'); end if;
  end if;
  if p_patch ? 'description' then
    if jsonb_typeof(p_patch -> 'description') <> 'string' then return bot_private.fail('BAD_REQUEST', 'description must be text'); end if;
    v_desc := btrim(p_patch ->> 'description');
    if v_desc = '' or char_length(v_desc) > 1000 then return bot_private.fail('BAD_REQUEST', 'description must be 1-1000 characters'); end if;
  end if;
  if p_patch ? 'status' then
    v_status := p_patch ->> 'status';
    if jsonb_typeof(p_patch -> 'status') <> 'string' or v_status not in ('pending', 'in_progress', 'completed', 'cancelled') then
      return bot_private.fail('BAD_REQUEST', 'status must be one of: pending, in_progress, completed, cancelled');
    end if;
  end if;

  update public.orders set
    order_name  = case when p_patch ? 'order_name'  then v_name     else order_name  end,
    price       = case when p_patch ? 'price'       then v_price    else price       end,
    category    = case when p_patch ? 'category'    then v_category else category    end,
    service     = case when p_patch ? 'service'     then v_service  else service     end,
    description = case when p_patch ? 'description' then v_desc     else description end,
    status      = case when p_patch ? 'status'      then v_status   else status      end
  where order_code = btrim(p_order_code)
  returning * into o;

  if not found then return bot_private.done(null); end if;
  return bot_private.done(bot_private.order_json(o));
end $$;

-- ── permissions: only the anon role (what the bot's public key maps to) may call these ───────────

revoke all on function bot_private.verify(text) from public, anon, authenticated;
revoke all on function bot_private.fail(text, text) from public, anon, authenticated;
revoke all on function bot_private.done(jsonb) from public, anon, authenticated;
revoke all on function bot_private.order_json(public.orders) from public, anon, authenticated;

revoke all on function public.bot_orders_list(text, text, int) from public, anon, authenticated;
revoke all on function public.bot_orders_get(text, text, text) from public, anon, authenticated;
revoke all on function public.bot_orders_search(text, text, text) from public, anon, authenticated;
revoke all on function public.bot_orders_create(text, text, text, text, numeric, text, text, text) from public, anon, authenticated;
revoke all on function public.bot_orders_update(text, text, jsonb) from public, anon, authenticated;

grant execute on function public.bot_orders_list(text, text, int) to anon;
grant execute on function public.bot_orders_get(text, text, text) to anon;
grant execute on function public.bot_orders_search(text, text, text) to anon;
grant execute on function public.bot_orders_create(text, text, text, text, numeric, text, text, text) to anon;
grant execute on function public.bot_orders_update(text, text, jsonb) to anon;

notify pgrst, 'reload schema';
