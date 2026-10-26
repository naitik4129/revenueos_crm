import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  backend,
  setCurrentWorkspaceId as syncBackendWorkspaceId,
  type Workspace,
} from "@/lib/backend-client";
import { keys } from "./query";
import { pickWorkspaceId } from "./workspace-selection";

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
function writeStoredWorkspaceId(id: string | null) {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Selection just won't survive a refresh — not worth surfacing.
  }
}

/** "Open CRM" from a platform project links here with ?project=<platform_project_id>. */
function readProjectParam(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("project");
  } catch {
    return null;
  }
}
function clearProjectParam() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("project");
    window.history.replaceState({}, "", url.toString());
  } catch {
    // Leaving the param in the URL is harmless.
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
 * Loads the workspaces this user may use (admins: all; salespeople: their memberships) and tracks which one is
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

  const currentWorkspaceId = useMemo(
    () => pickWorkspaceId(workspaces, storedId),
    [workspaces, storedId],
  );

  const currentWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? null,
    [workspaces, currentWorkspaceId],
  );

  useEffect(() => {
    syncBackendWorkspaceId(currentWorkspaceId);
  }, [currentWorkspaceId]);

  // Deep link from the platform: once the list has loaded, if ?project=<platform_project_id> names
  // a workspace this user can see, select it, then drop the param. Applied once.
  const appliedProjectParam = useRef(false);
  useEffect(() => {
    if (appliedProjectParam.current || !query.isSuccess) return;
    appliedProjectParam.current = true;
    const projectId = readProjectParam();
    if (!projectId) return;
    const match = workspaces.find((workspace) => workspace.platformProjectId === projectId);
    if (match) {
      setStoredId(match.id);
      writeStoredWorkspaceId(match.id);
    }
    clearProjectParam();
  }, [query.isSuccess, workspaces]);

  // A saved id the user may no longer use (membership removed, workspace deactivated) is
  // replaced once the list has loaded, so it does not come back on the next visit.
  useEffect(() => {
    if (query.isSuccess && currentWorkspaceId !== storedId) {
      setStoredId(currentWorkspaceId);
      writeStoredWorkspaceId(currentWorkspaceId);
    }
  }, [query.isSuccess, currentWorkspaceId, storedId]);

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
