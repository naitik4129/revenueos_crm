import { createContext, useContext } from "react";

export interface AddContactControls {
  open: () => void;
}

export const AddContactContext = createContext<AddContactControls>({ open: () => undefined });

export function useAddContact() {
  return useContext(AddContactContext);
}
