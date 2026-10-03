import { create } from "zustand";

// Remembered per browser: once the tour is finished or skipped it doesn't come back
// by itself (the sidebar's "Guided tour" replays it).
const KEY = "gloss-tour";

export function tourSeen(): boolean {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

/** Index of the current step, or null when the tour isn't showing. */
export const useTour = create<{ step: number | null }>(() => ({ step: null }));

export const startTour = () => useTour.setState({ step: 0 });

export function endTour(how: "done" | "skipped") {
  useTour.setState({ step: null });
  try {
    localStorage.setItem(KEY, how);
  } catch {
    // private mode: the tour may show again next time
  }
}
