import { useCallback, useMemo, useState } from "react";
import * as seed from "@/mocks/seed";
import type { Task } from "@/types";
import { createSliceContext } from "../context";
import type { NextId } from "../ids";
import { NOW } from "@/lib/dates";
import type { TimelineSlice } from "./timeline";

export interface TasksSlice {
  tasks: Task[];
  addTask: (task: Omit<Task, "id">) => void;
  toggleTask: (id: string) => void;
}

export const [TasksContext, useTasks] = createSliceContext<TasksSlice>("useTasks");

export function useTasksSlice(
  nid: NextId,
  addTimeline: TimelineSlice["addTimeline"],
  currentUserName: string,
): TasksSlice {
  const [tasks, setTasks] = useState<Task[]>(seed.tasks);

  const addTask = useCallback(
    (task: Omit<Task, "id">) => {
      const created: Task = { ...task, id: nid("tk") };
      setTasks((prev) => [created, ...prev]);
      addTimeline({
        leadId: task.leadId,
        at: NOW,
        kind: "task",
        title: "Task Created",
        actor: task.origin === "Automation" ? "n8n" : currentUserName,
        source: task.origin,
        detail: task.title,
      });
    },
    [nid, addTimeline, currentUserName],
  );

  const toggleTask = useCallback(
    (id: string) => {
      const task = tasks.find((t) => t.id === id);
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
      // Only completing a task is worth an audit entry; re-opening one is not.
      // Logged outside the updater — updaters must be pure.
      if (task && !task.done) {
        addTimeline({
          leadId: task.leadId,
          at: NOW,
          kind: "task",
          title: "Task Completed",
          actor: currentUserName,
          source: "Manual",
          detail: task.title,
        });
      }
    },
    [tasks, addTimeline, currentUserName],
  );

  return useMemo(() => ({ tasks, addTask, toggleTask }), [tasks, addTask, toggleTask]);
}
