import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { BackendError } from "./lib/backend-client";
import { keys } from "./store/query";

export const getRouter = () => {
  const queryClient: QueryClient = new QueryClient({
    // A 403 usually means this user just lost access to the current workspace: reload the
    // list so the switcher drops it.
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (
          error instanceof BackendError &&
          error.status === 403 &&
          query.queryKey[0] !== keys.workspaces[0]
        )
          void queryClient.invalidateQueries({ queryKey: keys.workspaces });
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: (count, error) =>
          !(error instanceof BackendError && error.status >= 400 && error.status < 500) &&
          count < 1,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });

  const router = createRouter({
    routeTree,
    // Served under /crm on the platform's domain (matches Vite's base).
    basepath: "/crm",
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
