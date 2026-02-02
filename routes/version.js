const express = require("express");
const moment = require("moment-timezone");
const Setting = require("../models/Setting");

const router = express.Router();

const TIMEZONE = "America/New_York";

// Stored in Mongo via Setting model (admin-controlled).
// Shape:
//   {
//     activeId: string|null,
//     versions: [{ id, version, message, dateISO }]
//   }
const APP_VERSION_KEY = "app_version_control";

function nowFormatted() {
  return moment(Date.now()).tz(TIMEZONE).format("YYYY-MM-DD HH:mm:ss");
}

function getPackageVersion() {
  try {
    // routes/version.js -> ../package.json
    const pkg = require("../package.json");
    return typeof pkg?.version === "string" && pkg.version.trim() ? pkg.version.trim() : "dev";
  } catch (_) {
    return "dev";
  }
}

function normalizeAppVersionControl(rawValue) {
  const v = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  const versions = Array.isArray(v.versions) ? v.versions : [];

  const cleaned = versions
    .map((e) => (e && typeof e === "object" && !Array.isArray(e) ? e : {}))
    .map((e) => {
      const id = typeof e.id === "string" ? e.id.trim() : "";
      const version = typeof e.version === "string" ? e.version.trim() : "";
      const message = typeof e.message === "string" ? e.message.slice(0, 500) : "";
      const dateISO = typeof e.dateISO === "string" ? e.dateISO.trim() : "";
      const d = new Date(dateISO);
      const safeDateISO = dateISO && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
      return {
        id: id || null,
        version: version || null,
        message: String(message || ""),
        dateISO: safeDateISO,
      };
    })
    .filter((e) => e.id && e.version)
    .sort((a, b) => {
      const ad = a.dateISO ? new Date(a.dateISO).getTime() : 0;
      const bd = b.dateISO ? new Date(b.dateISO).getTime() : 0;
      return bd - ad;
    });

  const activeId = typeof v.activeId === "string" ? v.activeId.trim() : "";
  const active = cleaned.find((e) => String(e.id) === String(activeId)) || null;

  // If activeId is invalid, fall back to newest entry.
  return {
    activeId: active ? String(active.id) : cleaned[0]?.id ? String(cleaned[0].id) : null,
    versions: cleaned,
  };
}

// Route to get the latest commit (cached)
router.get("/", async (req, res) => {
  // Always return 200 and never rely on GitHub.
  try {
    const setting = await Setting.findOne({ key: APP_VERSION_KEY }).select("value").lean();
    const control = normalizeAppVersionControl(setting?.value);

    const active = control.activeId
      ? control.versions.find((v) => String(v.id) === String(control.activeId)) || null
      : null;

    if (!active) {
      return res.status(200).json({
        version: getPackageVersion(),
        messageKey: 'footer.versionNotConfigured',
        message: 'Version not configured (set it in Admin → Version).',
        author: "",
        date: nowFormatted(),
        configured: false,
        source: "fallback",
      });
    }

    const date = active.dateISO
      ? moment(active.dateISO).tz(TIMEZONE).format("YYYY-MM-DD HH:mm:ss")
      : nowFormatted();

    return res.status(200).json({
      version: active.version,
      message: active.message || "",
      author: "",
      date,
      configured: true,
      source: "admin",
    });
  } catch (_) {
    // If DB is down, still return something useful.
    return res.status(200).json({
      version: getPackageVersion(),
      messageKey: 'footer.versionUnavailable',
      message: 'Version unavailable (DB).',
      author: "",
      date: nowFormatted(),
      configured: false,
      source: "fallback",
    });
  }
});

module.exports = router;