import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App as AntApp } from "antd";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { ThemeProvider } from "./theme";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AntApp>
        <AuthProvider>
          <App />
        </AuthProvider>
      </AntApp>
    </ThemeProvider>
  </StrictMode>,
);