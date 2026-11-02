import React from "react";
import ReactDOM from "react-dom/client";
import "@forge/ui/src/theme.css";
import "./hub.css";
import { APPS } from "./apps";
import hubLogo from "../../../brand/forge-hub-logo-256.png";
import coreLogo from "../../../brand/forge-core-logo-256.png";
import balanceLogo from "../../../brand/balance-forge-logo-256.png";
import assetLogo from "../../../brand/asset-forge-logo-256.png";
import pixelLogo from "../../../brand/pixel-forge-logo-256.png";

const LOGOS: Record<string, string> = {
  "forge-core": coreLogo,
  "balance-forge": balanceLogo,
  "asset-forge": assetLogo,
  "pixel-forge": pixelLogo,
};

function Hub() {
  return (
    <main className="hub">
      <header className="hub-head">
        <img src={hubLogo} alt="" />
        <div>
          <h1>Forge Suite</h1>
          <p>Test build for Android</p>
        </div>
      </header>
      <ul className="hub-apps">
        {APPS.map((app) => (
          <li key={app.id}>
            <a className="hub-app" href={`${app.id}.html`} style={{ "--forge-accent": app.accent } as React.CSSProperties}>
              <img src={LOGOS[app.id]} alt="" />
              <span>
                <strong>{app.name}</strong>
                <small>{app.description}</small>
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="hub-note">
        The apps are laid out for a computer screen, so they open zoomed out. Turn the phone sideways for a bigger view.
        Projects are kept inside this app on the phone. Tap the round button in a corner to come back here.
      </p>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Hub />
  </React.StrictMode>,
);
