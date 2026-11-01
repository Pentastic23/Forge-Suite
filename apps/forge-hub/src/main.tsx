import React from "react";
import ReactDOM from "react-dom/client";
import "@forge/ui/src/theme.css";
import "./hub.css";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
