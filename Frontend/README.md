# Northbeam CRM Frontend

Production-structured frontend for the Northbeam lead management and sales automation CRM. The application currently runs against deterministic in-memory mock data so the complete product flow can be demonstrated without backend services.

## Current scope

- React 19 and TypeScript
- TanStack Router file-based routing (client-side SPA, no SSR)
- Tailwind CSS and Radix UI primitives
- Domain-focused in-memory stores backed by mock fixtures
- Static `dist/` build served by Nginx in production
- Unit and screen smoke tests with Vitest and React Testing Library
- Multi-stage Docker image running as a non-root user

The current implementation does not connect to Supabase, n8n, authentication, or any external communication provider. Mock state resets when the application reloads.

## Project structure

```text
src/
  app/                 Application shell and global UI contexts
  components/
    common/            Shared product components
    ui/                Reusable UI primitives
  features/            Product screens grouped by business domain
  lib/                 Formatting, dates, telemetry and runtime helpers
  mocks/seed/          Deterministic mock records, split by domain
  routes/              Thin TanStack route definitions and metadata
  store/               Stable domain hooks and in-memory implementations
  types/               Backend-independent CRM domain contracts
```

The screens consume focused hooks exported from `src/store`. Future backend work should preserve those hook contracts and replace the mock-backed implementations with query and mutation adapters. Supabase-generated row types should be mapped into the domain contracts in `src/types` instead of being imported directly by UI components.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Docker with Docker Compose for containerized operation

## Local development

```bash
npm ci
npm run dev
```

The development server listens on `http://localhost:8080`.

## Quality checks

```bash
npm run check
```

The combined check runs formatting validation, linting, strict TypeScript checks, the test suite, and a production build. Individual commands are also available:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:run
npm run build
```

## Production runtime

Build the static bundle and preview it locally:

```bash
npm run build
npm run preview
```

`npm run build` produces a `dist/` directory of static assets — no Node server is required to run the built app.

## Docker

```bash
docker build -t northbeam-crm-frontend .
docker run --rm -p 8080:8080 northbeam-crm-frontend
```

The application is available at `http://localhost:8080`.

The image is a multi-stage build: a Node.js 22 stage runs `npm ci && npm run build`, and the runtime stage copies only the built `dist/` output into a non-root Nginx image (`nginxinc/nginx-unprivileged`), which serves it as static files with SPA fallback routing (`nginx.conf`) and an HTTP health check.

## Routes

| URL                                  | Screen              |
| ------------------------------------ | ------------------- |
| `/`                                  | Dashboard           |
| `/leads`                             | Lead list           |
| `/leads/:leadId`                     | Lead detail         |
| `/tasks`                             | Tasks               |
| `/meetings`                          | Meetings            |
| `/proposals`                         | Proposals           |
| `/automations`                       | Workflows           |
| `/automations/templates`             | Message templates   |
| `/automations/runs`                  | Workflow executions |
| `/automations/workflows/:workflowId` | Workflow builder    |

TanStack generates `src/routeTree.gen.ts`; do not edit that file manually.
