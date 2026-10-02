/**
 * PROTOTYPE (tabs), throwaway: Open in New Tab, for list rows, without
 * threading a prop through every pane.
 */
import { createContext, useContext } from "react";
import type { IssueDestination } from "../issue-navigation";

export const OpenInNewTab = createContext<
  ((issue: IssueDestination) => void) | undefined
>(undefined);

export function useOpenInNewTab() {
  return useContext(OpenInNewTab);
}
