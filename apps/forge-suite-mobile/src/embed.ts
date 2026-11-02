import { APPS } from "./apps";
import hubLogo from "../../../brand/forge-hub-logo-256.png";

/**
 * Starts one Forge app on its page: points its commands at its plugin, scales
 * it to fit the phone, adds a button back to the menu, then loads the app.
 */
export function openApp(id: string, load: () => Promise<unknown>) {
  const app = APPS.find((a) => a.id === id);
  if (!app) throw new Error(`Unknown app ${id}`);
  (globalThis as { __FORGE_PLUGIN__?: string }).__FORGE_PLUGIN__ = id;
  document.title = app.name;
  fitToScreen(app.width, addMenuButton());
  void load();
}

/**
 * The apps were laid out for a desktop window, so on a narrower screen the
 * whole page is zoomed out until the desktop width fits. Turning the phone
 * sideways gives a larger view.
 */
function fitToScreen(width: number, menuButton: HTMLElement) {
  const root = document.documentElement;
  const apply = () => {
    const zoom = Math.min(1, window.innerWidth / width);
    root.style.setProperty("zoom", String(zoom));
    // Keep the menu button at full size so it stays easy to tap.
    menuButton.style.setProperty("zoom", String(1 / zoom));
    // A zoomed page keeps its own size in CSS pixels, so stretch it back to fill the screen.
    root.style.width = `${window.innerWidth / zoom}px`;
    root.style.height = `${window.innerHeight / zoom}px`;
  };
  apply();
  window.addEventListener("resize", apply);
}

function addMenuButton(): HTMLElement {
  const button = document.createElement("a");
  button.href = "index.html";
  button.title = "Back to Forge Suite";
  button.setAttribute("aria-label", "Back to Forge Suite");
  button.innerHTML = `<img src="${hubLogo}" alt="" width="34" height="34" />`;
  Object.assign(button.style, {
    position: "fixed",
    right: "14px",
    bottom: "14px",
    zIndex: "2147483647",
    width: "50px",
    height: "50px",
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    background: "rgba(28, 34, 54, 0.92)",
    border: "1px solid #edbb2f",
    boxShadow: "0 6px 24px rgba(4, 8, 20, 0.55)",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(button);
  return button;
}
