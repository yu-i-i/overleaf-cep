-- wakapi-pg: normalize trusted-header-created user rows (idempotent).
-- Why (2026-10-26, staff SSO deployment):
--   Staff accounts are auto-created by Overleaf via trusted-header auth.
--   Wakapi stamps such rows with a non-local auth_type and leaves the
--   `email` column empty (wiped by migration 20250214-nullify-empty-email).
--   Both facts break the self-service path we need:
--     * routes/login.go (PostResetPassword) refuses resets for
--       auth_type != 'local' ("non-local user tried to reset password"),
--     * the reset lookup GetUserByEmail() misses rows with NULL email.
--   Result of the normalization: a header-created user is an ordinary
--   local-credential account (seeded by Overleaf) whose owner can use
--   "Forgot password?" at /wakapi/login.
-- Safety:
--   * UNIQUE idx_oidc (auth_type, sub): header rows have sub = NULL and
--     Postgres unique indexes ignore NULLs → unlimited ('local', NULL).
--     Real OIDC rows keep their (auth_type, sub) uniqueness.
--   * email := id only for id values that look like addresses; `id` for
--     trusted-header users IS the Overleaf user's email.
create or replace function wakapi_normalize_local_auth()
returns trigger language plpgsql as $$
begin
  if new.auth_type is distinct from 'local' then
    new.auth_type := 'local';
  end if;
  if (new.email is null or new.email = '') and position('@' in coalesce(new.id, '')) > 1 then
    new.email := new.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_wakapi_normalize_local_auth on users;
create trigger trg_wakapi_normalize_local_auth
before insert or update of auth_type, email on users
for each row execute function wakapi_normalize_local_auth();

-- one-time backfill for rows created before the trigger existed
update users set auth_type = 'local' where auth_type is distinct from 'local';
update users set email = id
 where (email is null or email = '')
   and position('@' in id) > 1;
