#!/usr/bin/env bash
# supabase-team.sql — no VAT while RAFD is not VAT-registered, on a throwaway PostgreSQL 16.
#   bash tests/team-vat-sql.sh [old-schema.sql]
# With an old schema file (e.g. `git show <rev>:supabase-team.sql > old.sql`), it is loaded first
# and a quote is sent under it, so the migration path the live database takes is what is tested.
# Supabase pieces the file needs are shimmed: anon/authenticated roles, pgcrypto in `extensions`,
# and a no-op net.http_post in place of pg_net. Writes only to its own temporary cluster.
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}
D=$(mktemp -d /tmp/team-vat-pg.XXXX); chmod 755 "$D"
RUN() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$D"
RUN "$PGBIN/initdb -D $D/data -U postgres >/dev/null 2>&1"
RUN "$PGBIN/pg_ctl -D $D/data -o '-p 54331 -k $D' -l $D/log -w start >/dev/null"
trap 'RUN "$PGBIN/pg_ctl -D $D/data -m immediate stop >/dev/null"; rm -rf "$D"' EXIT
P() { psql -h "$D" -p 54331 -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
shim() { sed 's/^create extension if not exists pg_net;$/create schema if not exists net; create or replace function net.http_post(url text, body jsonb, headers jsonb default null) returns bigint language sql as $$ select 0::bigint $$;/' "$1"; }
P -c "create role anon; create role authenticated; create role service_role; create schema extensions; create extension pgcrypto schema extensions;"

fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1 — got '$2', want '$3'"; fail=1; fi; }
seed() { P -c "insert into team_members(id, code, full_name, phone, pass_hash) values ('00000000-0000-0000-0000-000000000001','REP1','Rep','0500000001','x') on conflict do nothing;
  insert into team_leads(id, member_id, client_name, client_phone) values ('$1','00000000-0000-0000-0000-000000000001','Client','$2');
  insert into team_quotes(lead_id, details) values ('$1','request');"; }
send() { P -c "select team_admin((select value from team_config where key='admin_secret'),'quote_send','{\"lead_id\":\"$1\"$2,\"items\":[{\"d\":\"Basic\",\"q\":10,\"p\":349}]}'::jsonb)->>'ok'" >/dev/null; }
quote() { P -c "select vat||' '||total from team_quotes where lead_id='$1'"; }
OLD=00000000-0000-0000-0000-0000000000a1 A=00000000-0000-0000-0000-0000000000a2 B=00000000-0000-0000-0000-0000000000a3

if [ $# -ge 1 ]; then
  shim "$1" | P -f - >/dev/null 2>&1
  seed $OLD 0511111111; send $OLD ''
  check "old schema: a send without a vat key carried 15%" "$(quote $OLD)" "true 4013.50"
fi
shim supabase-team.sql | P -f - >/dev/null 2>&1
shim supabase-team.sql | P -f - >/dev/null 2>&1          # idempotent
check "vat column defaults to false" "$(P -c "select column_default from information_schema.columns where table_name='team_quotes' and column_name='vat'")" "false"
check "team_config.vat_registered is 'false'" "$(P -c "select value from team_config where key='vat_registered'")" "false"
[ $# -ge 1 ] && check "a quote sent before the change keeps its VAT" "$(quote $OLD)" "true 4013.50"
seed $A 0522222222; send $A ',"vat":true'
check "operator asks for VAT while unregistered → none" "$(quote $A)" "false 3490.00"
seed $B 0533333333; send $B ''
check "a send without a vat key → none" "$(quote $B)" "false 3490.00"
P -c "update team_config set value='true' where key='vat_registered'"; send $B ',"vat":true'
check "registered + asked → 15%" "$(quote $B)" "true 4013.50"
shim supabase-team.sql | P -f - >/dev/null 2>&1
check "re-running the file does not reset a registered company" "$(P -c "select value from team_config where key='vat_registered'")" "true"
check "anon cannot call team_quote_send" "$(P -c "select has_function_privilege('anon','team_quote_send(jsonb)','EXECUTE')")" "f"
[ $fail = 0 ] && echo "all passed" || { echo "FAILED"; exit 1; }
