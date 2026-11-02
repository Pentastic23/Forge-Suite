/**
 * Forge Suite mobile holds every Forge app in one Android app. Each app's
 * commands are registered there as a Tauri plugin named after the app id, and
 * the app's page sets `__FORGE_PLUGIN__` to that id before the app loads.
 * On desktop nothing sets it, so command names are used as they are.
 */
export function suiteCommand(cmd: string): string {
  const plugin = (globalThis as { __FORGE_PLUGIN__?: string }).__FORGE_PLUGIN__;
  return plugin ? `plugin:${plugin}|${cmd}` : cmd;
}
