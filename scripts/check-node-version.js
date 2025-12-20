/**
 * This project currently relies on transitive deps (via jsonwebtoken/jws/jwa)
 * that are not yet compatible with Node 23+ (e.g. Node 25 removes SlowBuffer).
 *
 * Render (and most production platforms) typically run an LTS release (18/20/22).
 * If you're using a "Current" Node locally, pin to an LTS to avoid install/runtime issues.
 */
const nodeVersion = process.versions.node || "";
const major = Number(String(nodeVersion).split(".")[0]);

if (!Number.isFinite(major)) {
  console.error(
    `[preinstall] Could not parse Node version: "${nodeVersion}". ` +
      "Please use Node 18/20/22 (LTS).",
  );
  process.exit(1);
}

if (major >= 23) {
  console.error(
    [
      `[preinstall] Unsupported Node.js version detected: v${nodeVersion}`,
      "",
      "This project currently requires an LTS Node release (18/20/22).",
      "Reason: a transitive dependency uses APIs removed/changed in Node 23+",
      '(commonly seen as "buffer-equal-constant-time" failing on SlowBuffer).',
      "",
      "Fix (Windows):",
      "- Install/use Node 22 LTS (recommended) or Node 20 LTS",
      "- Reinstall deps: delete node_modules + package-lock.json, then `npm install`",
      "",
      "Fix (macOS/Linux):",
      "- `nvm install 22 && nvm use 22` (or `nvm install 20 && nvm use 20`)",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

