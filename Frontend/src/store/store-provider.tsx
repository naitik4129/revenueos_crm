import type { ReactNode } from "react";
import { WorkspaceProvider } from "./workspace-context";

export function StoreProvider({ children }: { children: ReactNode }) {
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}
