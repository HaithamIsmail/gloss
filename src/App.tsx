import { lazy, Suspense, useEffect } from "react";
import { createBrowserRouter, Link, Outlet, RouterProvider, useLocation } from "react-router";
import { MoveHost } from "./components/MoveDialog";
import { SearchDialog } from "./components/SearchDialog";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { ThemeSync } from "./theme/ThemeSync";
import { TourHost } from "./tour/Tour";
import { TopBar } from "./components/TopBar";
import { DrawingModalHost } from "./drawing/DrawingModal";
import { SlideImportHost } from "./slides/SlideImport";
import { CoursePage } from "./pages/CoursePage";
import { BackupsPage } from "./pages/BackupsPage";
import { HomePage } from "./pages/HomePage";
import { SettingsPage } from "./pages/SettingsPage";
import { TrashPage } from "./pages/TrashPage";
import { useUI } from "./store";

// The editor is the heavy part of the bundle; load it with the first material opened.
const MaterialPage = lazy(() => import("./pages/MaterialPage").then((m) => ({ default: m.MaterialPage })));
const CanvasListPage = lazy(() => import("./pages/CanvasListPage").then((m) => ({ default: m.CanvasListPage })));
const CanvasPage = lazy(() => import("./pages/CanvasPage").then((m) => ({ default: m.CanvasPage })));
const HistoryHost = lazy(() => import("./components/HistoryDialog").then((m) => ({ default: m.HistoryHost })));
const PrintPage = lazy(() => import("./pages/PrintPage").then((m) => ({ default: m.PrintPage })));

function Layout() {
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const historyOpen = useUI((s) => !!s.historyFor);
  const { pathname } = useLocation();

  // On phones the sidebar overlays the page; get it out of the way after navigating.
  useEffect(() => {
    if (window.innerWidth <= 760) useUI.getState().setSidebarOpen(false);
  }, [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Excalidraw has its own shortcuts (Ctrl+K adds a link there).
      if ((e.target as Element | null)?.closest?.(".excalidraw")) return;
      const ui = useUI.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        // With text selected in a page, Ctrl+K makes a link (the editor's own shortcut).
        const inEditor = (e.target as Element | null)?.closest?.(".bn-editor");
        if (inEditor && !window.getSelection()?.isCollapsed) return;
        e.preventDefault();
        ui.setSearchOpen(!ui.searchOpen);
      } else if (e.key === "Escape" && ui.linking && !ui.searchOpen) {
        ui.setLinking(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={`app${sidebarOpen ? "" : " sidebar-closed"}`}>
      <Sidebar />
      <main className="main">
        <TopBar />
        <div className="main-scroll" id="main-scroll">
          <Suspense fallback={<div className="page page-narrow muted">Loading…</div>}>
            <Outlet />
          </Suspense>
        </div>
      </main>
      <SearchDialog />
      <DrawingModalHost />
      <SlideImportHost />
      {historyOpen && (
        <Suspense fallback={null}>
          <HistoryHost />
        </Suspense>
      )}
      <MoveHost />
      <Toasts />
      <TourHost />
      <ThemeSync />
    </div>
  );
}

function NotFound() {
  return (
    <div className="page page-narrow">
      <div className="kicker">Not found</div>
      <h1 className="page-title">Nothing here</h1>
      <p className="muted">
        This page was deleted or never existed. <Link to="/">Back to all courses</Link>.
      </p>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "c/:courseId", element: <CoursePage /> },
      { path: "m/:materialId", element: <MaterialPage /> },
      { path: "canvas", element: <CanvasListPage /> },
      { path: "canvas/:drawingId", element: <CanvasPage /> },
      { path: "trash", element: <TrashPage /> },
      { path: "backups", element: <BackupsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "settings/:tab", element: <SettingsPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
  // Printable views (Save as PDF), without the app around them.
  {
    path: "print/:scope/:id",
    element: (
      <Suspense fallback={<div className="print-page muted">Loading…</div>}>
        <PrintPage />
      </Suspense>
    ),
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
