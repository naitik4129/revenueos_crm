import { useCallback, useMemo, useState } from "react";
import * as seed from "@/mocks/seed";
import type { AppNotification } from "@/types";
import { createSliceContext } from "../context";

export interface NotificationsSlice {
  notifications: AppNotification[];
  markNotificationsRead: () => void;
}

export const [NotificationsContext, useNotifications] =
  createSliceContext<NotificationsSlice>("useNotifications");

export function useNotificationsSlice(): NotificationsSlice {
  const [notifications, setNotifications] = useState<AppNotification[]>(seed.notifications);

  const markNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  return useMemo(
    () => ({ notifications, markNotificationsRead }),
    [notifications, markNotificationsRead],
  );
}
