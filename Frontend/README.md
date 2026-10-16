# MOTM Flow Frontend

React 19 frontend for the Northbeam CRM v2: one workspace per client, with companies, contacts,
deals, tasks, meetings, proposals, automations, settings and an admin area. All CRM data is read
and written through the authenticated `Backend/` API. Supabase JS is used only for browser
sign-in and the session. The pages are listed in [`../CONTEXT.md`](../CONTEXT.md#frontend-pages);
rules and decisions are in [`../CLAUDE.md`](../CLAUDE.md).

## Architecture

- TanStack Router provides the client-side routes (`src/routes`, generated `src/routeTree.gen.ts`).
- TanStack Query owns all backend server state, cache keys, mutation state and invalidation.
- `src/lib/backend-client.ts` is the typed HTTP boundary; it attaches the Supabase access token
  and the current workspace (`X-Workspace-Id`).
- `src/store/` exposes the hooks the pages use (workspace selection, lists, details, mutations).
- `src/types` holds the backend's domain contracts.
- `src/lib/labels.ts` and the date helpers keep labels and Asia/Kolkata display out of the API
  contracts.
- Missing configuration and backend failures render explicit error states; there is no
  demo-data fallback in the app.
- `/admin` is for admins only (the root route redirects everyone else); the backend checks every
  call anyway.

## Required configuration

Copy `.env.example` to `.env.local` and set all three browser-safe values:

```text
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_API_BASE_URL=http://localhost:8787
```

Never place the Supabase service-role key or backend credentials in the frontend environment.

## Development

Node.js 22 and npm 10 or newer are required.

```bash
npm ci
npm run dev
```

The development server listens on `http://localhost:8080`.

For a click-through without Supabase, run the demo from the backend (`cd ../Backend && npm run
demo`): it starts this dev server against a local fake backend, with a demo-user login that
exists only in development builds. See
[`../Backend/README.md`](../Backend/README.md#demo-mode-local-click-through).

## Quality checks

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:run
npm run build
```

The tests cover the API client, query invalidation, presentation helpers, page behaviour with
mocked hooks, and route smoke tests for zero-record states. A real authenticated flow needs
configured Supabase and backend environments.

## Production

`npm run build` writes the static SPA to `dist/` (and regenerates `src/routeTree.gen.ts`). The
backend URL and Supabase public configuration are injected at build time.
