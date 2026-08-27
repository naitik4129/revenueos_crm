import { createContext, useContext } from "react";

export interface AddLeadControls {
  open: () => void;
}

export const AddLeadContext = createContext<AddLeadControls>({ open: () => undefined });

export function useAddLead() {
  return useContext(AddLeadContext);
}
