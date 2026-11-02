import assetForge from "../../../brand/asset-forge-logo-256.png";
import balanceForge from "../../../brand/balance-forge-logo-256.png";
import forgeCore from "../../../brand/forge-core-logo-256.png";
import forgeHub from "../../../brand/forge-hub-logo-256.png";
import pixelForge from "../../../brand/pixel-forge-logo-256.png";

/**
 * Logos for the suite's own apps, bundled into Forge Hub so their tiles always
 * show the current brand icon, even when an install has no icon.png beside it.
 */
export const SUITE_ICONS: Record<string, string> = {
  "asset-forge": assetForge,
  "balance-forge": balanceForge,
  "forge-core": forgeCore,
  "forge-hub": forgeHub,
  "pixel-forge": pixelForge,
};
