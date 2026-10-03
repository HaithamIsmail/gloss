import { create } from "zustand";

export type ToastAction = { label: string; run: () => void | Promise<void> };
export type Toast = { id: number; message: string; action?: ToastAction };

export const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));

let nextId = 1;
const timers = new Map<number, number>();

export function dismissToast(id: number) {
  window.clearTimeout(timers.get(id));
  timers.delete(id);
  useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

/** A short message at the bottom of the screen, optionally with one action (e.g. Undo). */
export function toast(message: string, action?: ToastAction, ms = action ? 8000 : 4000) {
  const id = nextId++;
  useToasts.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, action }] }));
  timers.set(id, window.setTimeout(() => dismissToast(id), ms));
  return id;
}
