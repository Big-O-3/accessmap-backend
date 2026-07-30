# accessmap-backend

Backend API for AccessMap, a platform that helps wheelchair users find accessible venues. Users upload venue photos, an AI vision model detects accessibility features like ramps and grab bars, and the community verifies each one to produce a 0 to 100 accessibility score. Built with Node/Express, PostgreSQL, Grounding DINO, Google OAuth, and Cloudinary.

## Local development

1. `npm install`
2. Copy `.env.example` → `.env` and fill in the values (Supabase Postgres, Supabase auth, Cloudinary, the ML service URL, and `CORS_ORIGINS`). Set both `DATABASE_URL` (runtime) and `DIRECT_URL` (migrations) — locally they can be the same direct connection.
3. Apply migrations to your database: `npx prisma migrate deploy`
4. `npm run dev` — starts the server with nodemon on `PORT` (default 3000).

## Database migrations

Schema lives in `prisma/schema.prisma`; every change ships with a migration in `prisma/migrations/`.

- **Create a migration** after editing the schema: `npm run prisma:migrate` (`prisma migrate dev`) — generates the SQL and applies it locally.
- **Apply pending migrations** to any database (prod included): `npm run migrate:deploy` (`prisma migrate deploy`) — only applies committed migrations, never generates or resets.

A schema change without a committed migration will 500 the routes that read the new columns once the code deploys against a database that doesn't have them. Always commit the migration alongside the schema change.

## Deploying (Render)

Auto-deploy is off — redeploy manually, backend before frontend.

The build step runs migrations so a deploy brings the database in sync before the new server starts:

```
npm ci && npm run build        # = npm ci && prisma generate && prisma migrate deploy
```

`prisma migrate deploy` runs at **build** time, so a failed migration fails the build and blocks the deploy rather than crash-looping a live server. `prisma` is a runtime dependency (not a devDependency) so its CLI is present even when the install runs with `NODE_ENV=production`.

Migrations connect through **`DIRECT_URL`**, not `DATABASE_URL`. On Supabase, `DATABASE_URL` is the transaction pooler (port 6543, `?pgbouncer=true`), which the runtime uses but which **hangs `migrate deploy`** — the migration engine needs advisory locks + DDL over a direct/session connection. Set `DIRECT_URL` to a direct/session URL (session pooler port 5432, no pgbouncer). It must always be set, but only migration commands use it (the server and `prisma generate` don't connect through it).

`render.yaml` captures this as a blueprint, **but Render does not retroactively apply a blueprint to a service created through the dashboard.** For the existing backend service, set the same **Build Command** in the dashboard (Settings → Build & Deploy):

```
npm ci && npm run build
```

Start command stays `npm start`. Environment variables are set in the dashboard (see `.env.example` for the full list); never commit their values.
