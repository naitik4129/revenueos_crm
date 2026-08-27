import { useMemo } from "react";
import * as seed from "@/mocks/seed";
import type { User } from "@/types";
import { createSliceContext } from "../context";

export interface SessionSlice {
  users: User[];
  currentUser: User;
  userName: (id: string) => string;
}

export const [SessionContext, useSession] = createSliceContext<SessionSlice>("useSession");

/** Directory + signed-in user. Static until real auth replaces the seed. */
export function useSessionSlice(): SessionSlice {
  return useMemo(
    () => ({
      users: seed.users,
      currentUser: seed.currentUser,
      userName: (id: string) => seed.users.find((u) => u.id === id)?.name ?? "Unassigned",
    }),
    [],
  );
}
