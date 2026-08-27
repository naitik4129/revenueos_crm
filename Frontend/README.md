# Northbeam CRM Frontend

React 19 frontend for Northbeam's lead-management and sales-automation CRM. Production CRM data is loaded and mutated exclusively through the authenticated `Backend/` API. Supabase JS is used only for browser authentication and session management.

## Architecture

- TanStack Router provides the client-side routes.
- TanStack Query owns all backend server state, cache keys, mutation state, and invalidation.
- `src/lib/backend-client.ts` is the typed HTTP boundary and attaches the current Supabase access token.
- `src/store/server-hooks.ts` exposes domain hooks consumed by the existing screens.
- `src/types` contains backend-authoritative lowercase domain contracts.
- `src/lib/labels.ts` and the date helpers keep presentation labels and Asia/Kolkata display concerns out of the API contracts.
- Missing configuration and backend failures render explicit error states; there is no demo-data fallback.

## Required configuration

Copy `.env.example` to `.env.local` and set all three browser-safe values:

```text
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_API_BASE_URL=http://localhost:8787
```

Never place the Supabase service-role key or backend service credentials in the frontend environment.

## Development

Node.js 22 and npm 10 or newer are required.

```bash
npm ci
npm run dev
```

The development server listens on `http://localhost:8080`.

## Quality checks

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:run
npm run build
```

The test suite uses an explicit fetch harness for API operations, presentation-helper tests, query-invalidation coverage, and route smoke tests for zero-record states. A real authenticated persistence flow requires configured Supabase and backend environments.

## Production

`npm run build` writes the static SPA to `dist/`. The backend URL and Supabase public configuration are injected at build time.
