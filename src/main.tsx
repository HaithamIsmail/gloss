import "@fontsource-variable/archivo";
import "@blocknote/mantine/style.css";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/editor.css";
import "./styles/features.css";
import "./styles/tour.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { queryClient } from "./api";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
