import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  backend,
  setCurrentWorkspaceId as syncBackendWorkspaceId,
  type Workspace,
} from "@/lib/backend-client";
import { keys } from "./query";

const STORAGE_KEY = "motmflow.workspaceId";

function readStoredWorkspaceId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private browsing / blocked storage — fall through to the "nothing
    // stored" path below, which resolves to the first workspace once the
    // list loads.
    return null;
  }
}
function writeStoredWorkspaceId(id: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Selection just won't survive a refresh — not worth surfacing.
  }
}

export interface WorkspaceControls {
  workspaces: Workspace[];
  currentWorkspaceId: string | null;
  currentWorkspace: Workspace | null;
  setCurrentWorkspaceId: (id: string) => void;
  isLoading: boolean;
}

const WorkspaceContext = createContext<WorkspaceControls>({
  workspaces: [],
  currentWorkspaceId: null,
  currentWorkspace: null,
  setCurrentWorkspaceId: () => undefined,
  isLoading: true,
});

export function useWorkspace() {
  return useContext(WorkspaceContext);
}

/**
 * Loads the salesperson's available workspaces and tracks which one is
 * selected. Every CRM request needs the selected workspace's id as the
 * X-Workspace-Id header (see backend-client.ts), so this provider is the
 * single place that owns the selection and keeps the backend client's
 * module-level copy of it in sync.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: keys.workspaces,
    queryFn: ({ signal }) => backend.workspaces.list(signal),
    staleTime: 60_000,
  });
  const workspaces = useMemo(() => query.data?.data ?? [], [query.data]);

  const [storedId, setStoredId] = useState<string | null>(() => readStoredWorkspaceId());

  // Once the list resolves, fall back to the first workspace when the
  // stored id was never set, or names a workspace that's been deleted or
  // deactivated since — covers a stale localStorage value without crashing.
  const currentWorkspaceId = useMemo(() => {
    if (workspaces.length === 0) return null;
    if (storedId && workspaces.some((workspace) => workspace.id === storedId)) return storedId;
    return workspaces[0]!.id;
  }, [workspaces, storedId]);

  const currentWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? null,
    [workspaces, currentWorkspaceId],
  );

  useEffect(() => {
    syncBackendWorkspaceId(currentWorkspaceId);
  }, [currentWorkspaceId]);

  const setCurrentWorkspaceId = (id: string) => {
    setStoredId(id);
    writeStoredWorkspaceId(id);
  };

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        currentWorkspaceId,
        currentWorkspace,
        setCurrentWorkspaceId,
        isLoading: query.isLoading,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
