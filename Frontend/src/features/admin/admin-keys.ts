export const adminKeys = {
  users: ["admin", "users"] as const,
  members: (workspaceId: string) => ["admin", "members", workspaceId] as const,
  brainKeys: (workspaceId: string) => ["admin", "brain-keys", workspaceId] as const,
  sending: (workspaceId: string) => ["admin", "sending", workspaceId] as const,
};

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";
