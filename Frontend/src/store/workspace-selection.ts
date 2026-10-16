/**
 * The workspace to use: the saved one if the user may still use it, else the first one.
 * Null when the user has no workspace (a salesperson with no membership yet).
 */
export function pickWorkspaceId(workspaces: { id: string }[], savedId: string | null) {
  if (workspaces.length === 0) return null;
  if (savedId && workspaces.some((workspace) => workspace.id === savedId)) return savedId;
  return workspaces[0]!.id;
}
