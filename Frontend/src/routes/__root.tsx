import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  Navigate,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { reportError } from "@/lib/telemetry";
import { AppShell } from "@/app/app-shell";
import { StoreProvider } from "@/store";
import { Toaster } from "@/components/ui/sonner";
import { configurationError } from "@/lib/supabase-client";
import { useSupabaseSession } from "@/lib/use-supabase-session";
import { LoginPage } from "@/features/auth/login-page";
import { backend } from "@/lib/backend-client";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportError(error, { boundary: "root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "author", content: "Northbeam CRM" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap",
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <HeadContent />
      <AuthGate queryClient={queryClient}>
        <Outlet />
      </AuthGate>
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}

/** Gates the application behind required Supabase authentication. */
function AuthGate({ children, queryClient }: { children: ReactNode; queryClient: QueryClient }) {
  const { loading, session } = useSupabaseSession();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const me = useQuery({
    queryKey: ["auth", "role", session?.user.id],
    queryFn: ({ signal }) => backend.me(signal),
    enabled: Boolean(session),
    staleTime: 60_000,
  });
  const adminPath = pathname.startsWith("/admin");

  useEffect(() => {
    if (!loading && !session) queryClient.clear();
  }, [loading, session, queryClient]);

  if (configurationError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-lg rounded-lg border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Northbeam CRM is not configured</h1>
          <p className="mt-2 text-sm text-muted-foreground">{configurationError}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Add the browser-safe values documented in Frontend/.env.example and restart the
            frontend.
          </p>
        </div>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!session) return <LoginPage adminMode={adminPath} />;
  if (me.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Checking access…
      </div>
    );
  }
  if (me.isError || !me.data) throw me.error;
  if (me.data.role === "admin") {
    if (!adminPath) return <Navigate to="/admin" replace />;
    return <>{children}</>;
  }
  if (adminPath) return <Navigate to="/" replace />;
  return (
    <StoreProvider>
      <AppShell>{children}</AppShell>
    </StoreProvider>
  );
}
