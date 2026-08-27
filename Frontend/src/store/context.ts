import { createContext, useContext, type Context } from "react";

/**
 * One context per domain slice, so a component that reads tasks does not
 * re-render when an unrelated slice (leads, workflows, …) changes.
 */
export function createSliceContext<T>(name: string): [Context<T | null>, () => T] {
  const SliceContext = createContext<T | null>(null);
  SliceContext.displayName = name;

  function useSlice(): T {
    const value = useContext(SliceContext);
    if (!value) throw new Error(`${name} must be used inside <StoreProvider>`);
    return value;
  }

  return [SliceContext, useSlice];
}
