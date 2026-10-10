#!/bin/sh
# Runs once, on first start of an empty database: creates the low-privilege application role.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v role="$APP_DB_ROLE" -v pw="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE :"role" LOGIN PASSWORD :'pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE rafd TO :"role";
GRANT USAGE ON SCHEMA public TO :"role";
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
