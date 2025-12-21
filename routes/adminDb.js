const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const readline = require("readline");
const multer = require("multer");

// Use MongoDB Extended JSON to preserve ObjectId/Date/etc.
// bson is a transitive dependency of mongoose (mongodb driver).
let EJSON;
try {
  ({ EJSON } = require("bson"));
} catch (_) {
  EJSON = null;
}

const router = express.Router();

const BACKUP_DIR = path.join(process.cwd(), "backups");
const MAX_UPLOAD_BYTES = 250 * 1024 * 1024; // 250MB

function requireAdmin(req) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    const err = new Error("Authentication token is required");
    err.statusCode = 401;
    throw err;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded?.admin) {
      const err = new Error("You do not have admin privileges");
      err.statusCode = 403;
      throw err;
    }
    return decoded;
  } catch (e) {
    if (e instanceof jwt.JsonWebTokenError) {
      const err = new Error("Invalid or expired token");
      err.statusCode = 401;
      throw err;
    }
    throw e;
  }
}

function safeBackupFileName(raw) {
  const name = String(raw || "").trim();
  // Only allow simple filenames to avoid traversal.
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return null;
  if (!name.endsWith(".ndjson.gz")) return null;
  return name;
}

async function ensureBackupDir() {
  await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function backupFileNameFromDb(dbName) {
  const safeDb = String(dbName || "db").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60) || "db";
  return `mongo-backup-${safeDb}-${nowStamp()}.ndjson.gz`;
}

function requireDbReady() {
  if (!mongoose?.connection || mongoose.connection.readyState !== 1) {
    const err = new Error("MongoDB connection is not ready");
    err.statusCode = 503;
    throw err;
  }
  if (!EJSON) {
    const err = new Error("bson EJSON is not available in this environment");
    err.statusCode = 500;
    throw err;
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        await ensureBackupDir();
        cb(null, BACKUP_DIR);
      } catch (e) {
        cb(e);
      }
    },
    filename: (req, file, cb) => {
      // Keep uploads isolated; we rename during restore if needed.
      const name = `upload-${nowStamp()}-${Math.random().toString(16).slice(2)}.ndjson.gz`;
      cb(null, name);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

async function listBackupFiles() {
  await ensureBackupDir();
  const entries = await fs.promises.readdir(BACKUP_DIR, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((n) => safeBackupFileName(n))
    .sort()
    .reverse();

  const out = [];
  for (const name of files) {
    const full = path.join(BACKUP_DIR, name);
    try {
      const stat = await fs.promises.stat(full);
      out.push({
        name,
        sizeBytes: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    } catch (_) {
      // ignore races
    }
  }
  return out;
}

// Admin: list existing backups (metadata only)
router.get("/db/backups", async (req, res) => {
  try {
    requireAdmin(req);
    const backups = await listBackupFiles();
    return res.status(200).json({ backups });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
});

// Admin: create a new backup and store it on the server
router.post("/db/backup", async (req, res) => {
  try {
    requireAdmin(req);
    requireDbReady();
    await ensureBackupDir();

    const db = mongoose.connection.db;
    const dbName = db?.databaseName || "db";
    const fileName = backupFileNameFromDb(dbName);
    const fullPath = path.join(BACKUP_DIR, fileName);

    const gzip = zlib.createGzip({ level: 9 });
    const fileOut = fs.createWriteStream(fullPath, { flags: "wx" });
    gzip.pipe(fileOut);

    function writeLine(obj) {
      const line = EJSON.stringify(obj) + "\n";
      return gzip.write(line);
    }

    // Header
    writeLine({
      type: "meta",
      version: 1,
      createdAt: new Date().toISOString(),
      dbName,
      format: "ndjson+gzip",
    });

    const collections = await db.listCollections().toArray();
    const userCollections = collections
      .map((c) => c?.name)
      .filter(Boolean)
      .filter((name) => !String(name).startsWith("system."));

    for (const name of userCollections) {
      writeLine({ type: "collection", name });
      const cursor = db.collection(name).find({});
      // Stream docs one-by-one (no giant in-memory array)
      for await (const doc of cursor) {
        writeLine({ type: "doc", collection: name, doc });
      }
    }

    writeLine({ type: "end" });
    gzip.end();

    await new Promise((resolve, reject) => {
      fileOut.on("finish", resolve);
      fileOut.on("error", reject);
      gzip.on("error", reject);
    });

    const stat = await fs.promises.stat(fullPath);
    return res.status(201).json({
      message: "Backup created",
      backup: { name: fileName, sizeBytes: stat.size, createdAt: new Date().toISOString() },
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
});

// Admin: download a specific backup
router.get("/db/backups/:name", async (req, res) => {
  try {
    requireAdmin(req);
    const safe = safeBackupFileName(req.params?.name);
    if (!safe) return res.status(400).json({ message: "Invalid backup name" });

    const full = path.join(BACKUP_DIR, safe);
    await fs.promises.access(full, fs.constants.R_OK);

    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
    fs.createReadStream(full).pipe(res);
  } catch (err) {
    const code = err.code === "ENOENT" ? 404 : err.statusCode || 500;
    return res.status(code).json({ message: err.message || "Internal server error" });
  }
});

// Admin: delete a backup file
router.delete("/db/backups/:name", async (req, res) => {
  try {
    requireAdmin(req);
    const safe = safeBackupFileName(req.params?.name);
    if (!safe) return res.status(400).json({ message: "Invalid backup name" });

    const full = path.join(BACKUP_DIR, safe);
    await fs.promises.unlink(full);
    return res.status(200).json({ message: "Backup deleted" });
  } catch (err) {
    const code = err.code === "ENOENT" ? 404 : err.statusCode || 500;
    return res.status(code).json({ message: err.message || "Internal server error" });
  }
});

// Admin: restore from an uploaded backup.
// Query: ?drop=true to drop collections before insert (recommended).
router.post("/db/restore", upload.single("backup"), async (req, res) => {
  let uploadedPath = null;
  try {
    requireAdmin(req);
    requireDbReady();

    const drop = String(req.query?.drop || req.body?.drop || "").toLowerCase() === "true";
    const file = req.file;
    if (!file?.path) {
      return res.status(400).json({ message: "No backup file uploaded" });
    }
    uploadedPath = file.path;

    const db = mongoose.connection.db;
    const gunzip = zlib.createGunzip();
    const input = fs.createReadStream(uploadedPath).pipe(gunzip);

    const rl = readline.createInterface({ input, crlfDelay: Infinity });

    let meta = null;
    let currentCollection = null;
    let batch = [];
    const dropped = new Set();
    const insertedCountByCollection = new Map();

    async function flushBatch() {
      if (!currentCollection || batch.length === 0) return;
      const coll = db.collection(currentCollection);
      try {
        const result = await coll.insertMany(batch, { ordered: false });
        const inserted = result?.insertedCount || 0;
        insertedCountByCollection.set(
          currentCollection,
          (insertedCountByCollection.get(currentCollection) || 0) + inserted
        );
      } catch (e) {
        // If restoring into an existing DB without dropping, duplicates are likely.
        // Surface a clear error instead of half-success.
        const err = new Error(
          `Restore failed while inserting into "${currentCollection}": ${e?.message || "insertMany error"}`
        );
        err.statusCode = 400;
        throw err;
      } finally {
        batch = [];
      }
    }

    async function ensureDropped(name) {
      if (!drop) return;
      if (dropped.has(name)) return;
      dropped.add(name);
      try {
        await db.collection(name).drop();
      } catch (e) {
        // If collection doesn't exist, ignore.
        if (e?.codeName !== "NamespaceNotFound" && e?.code !== 26) throw e;
      }
    }

    for await (const line of rl) {
      const trimmed = String(line || "").trim();
      if (!trimmed) continue;

      let obj;
      try {
        obj = EJSON.parse(trimmed);
      } catch (_) {
        const err = new Error("Invalid backup format (cannot parse JSON line)");
        err.statusCode = 400;
        throw err;
      }

      if (obj?.type === "meta") {
        meta = obj;
        continue;
      }

      if (obj?.type === "collection") {
        await flushBatch();
        currentCollection = String(obj?.name || "").trim();
        if (!currentCollection || currentCollection.startsWith("system.")) {
          currentCollection = null;
          continue;
        }
        await ensureDropped(currentCollection);
        continue;
      }

      if (obj?.type === "doc") {
        const coll = String(obj?.collection || "").trim();
        if (!coll || coll.startsWith("system.")) continue;
        if (currentCollection !== coll) {
          await flushBatch();
          currentCollection = coll;
          await ensureDropped(currentCollection);
        }
        if (obj?.doc && typeof obj.doc === "object") {
          batch.push(obj.doc);
          if (batch.length >= 500) {
            await flushBatch();
          }
        }
        continue;
      }
    }

    await flushBatch();

    // Cleanup upload after successful restore
    try {
      await fs.promises.unlink(uploadedPath);
      uploadedPath = null;
    } catch (_) {}

    return res.status(200).json({
      message: "Restore completed",
      meta,
      drop,
      inserted: Object.fromEntries(insertedCountByCollection.entries()),
    });
  } catch (err) {
    // Best-effort cleanup
    if (uploadedPath) {
      try {
        await fs.promises.unlink(uploadedPath);
      } catch (_) {}
    }
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
});

module.exports = router;

