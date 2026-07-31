# accessmap-backend
Backend API for AccessMap, a platform that helps wheelchair users find accessible venues. Users upload venue photos, an AI vision model detects accessibility features like ramps and grab bars, and the community verifies each one to produce a 0 to 100 accessibility score. Built with Node/Express, PostgreSQL, Grounding DINO, Google OAuth, and Cloudinary.

## Local setup

1. `cp .env.example .env` and fill it in. Every var in `.env.example` is
   required except where noted. Note **`DIRECT_URL`**: because it's wired to
   `directUrl` in `prisma/schema.prisma`, every `prisma` command errors
   (`P1012`) if it's unset. In local dev just set it to the same value as
   `DATABASE_URL` - a local Postgres connection is already direct.
2. `npm install` (runs `prisma generate` via `postinstall`).
3. `npm run prisma:migrate` to apply migrations to your dev DB.
4. `npm run dev`.

## Deploy (Render + Supabase)

Migrations are applied automatically on deploy, so pushing to `main` is enough
to ship a schema change.

- **Build command:** `npm install && npm run prisma:deploy`
  (`prisma migrate deploy` applies any pending migrations; it's a no-op when the
  DB is already current, so it's safe on every deploy.)
- **Start command:** `npm start`

These are captured in [`render.yaml`](./render.yaml) so a Blueprint deploy sets
them up automatically. If the service already exists and isn't managed by the
Blueprint, set the same build command on the dashboard
(Settings → Build & Deploy → Build Command).

### Database URLs (two of them)

Supabase's pooler can't run migrations (they need advisory locks + DDL over a
direct connection), so the app uses two connection strings:

| Env var | Used by | Supabase value |
| --- | --- | --- |
| `DATABASE_URL` | runtime queries | Pooler connection (session pooler, port 5432 - see `.env.example`) |
| `DIRECT_URL` | `prisma migrate deploy` | **Direct connection** (host `db.<ref>.supabase.co`, port 5432 - Settings → Database → Connection string → *Direct connection*) |

Set **both** in the Render dashboard (Environment). Without `DIRECT_URL` the
build's migrate step fails.
