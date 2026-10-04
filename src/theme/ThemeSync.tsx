import { useEffect } from "react";
import { useLocation } from "react-router";
import { useThemes } from "../api";
import { applyTheme } from "./theme";

const DEFAULT = "builtin/modernist";

/**
 * Keeps the app's look in step with the chosen theme. The theme list is
 * refetched when the window regains focus, so saving a theme file in an editor
 * and switching back to Gloss shows the change.
 */
export function ThemeSync() {
  const { data } = useThemes();
  const { pathname } = useLocation();
  const current = data?.themes.find((t) => t.id === data.current);

  useEffect(() => {
    if (data) void applyTheme(current, DEFAULT);
  }, [data, current?.id, current?.updatedAt, pathname.startsWith("/print/")]);

  return null;
}
