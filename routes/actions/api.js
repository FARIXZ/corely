import express from "express";
import fs from "fs/promises";
import path from "path";
import { execFile, exec } from "child_process";
import crypto from "crypto";
import os from "os";

const router = express.Router();
const DATA_FILE = path.join(process.cwd(), "data", "actions.json");
const SETTINGS_FILE = path.join(process.cwd(), "data", "settings.json");

// ─────────────────────────────────────────────────────────────
//  CommandManager — hardened process execution engine
// ─────────────────────────────────────────────────────────────
class CommandManager {
  constructor(opts = {}) {
    // Per-action cooldown (prevents spamming the same action)
    this.rateLimitMs = opts.rateLimitMs ?? 3000;

    // Hard timeout per process — kills it if still running after this
    this.processTimeoutMs = opts.processTimeoutMs ?? 15000;

    // Max output buffer per process (prevents memory explosion from chatty commands)
    this.maxBuffer = opts.maxBuffer ?? 512 * 1024; // 512 KB

    // Global concurrent process cap — prevents fork-bomb scenarios
    this.maxConcurrent = opts.maxConcurrent ?? 5;

    // Maps actionId → last execution timestamp (for rate limiting)
    this._lastExecTime = new Map();

    // Set of currently running process references (for lifecycle tracking)
    this._runningProcesses = new Set();

    // Periodic cleanup to prevent unbounded Map growth from deleted actions
    this._cleanupInterval = setInterval(() => this._cleanup(), 60_000);
    this._cleanupInterval.unref(); // Don't prevent Node from exiting
  }

  /**
   * Check if an action is currently rate-limited.
   * @returns {{ limited: boolean, retryAfterMs?: number }}
   */
  isRateLimited(actionId) {
    const last = this._lastExecTime.get(actionId);
    if (!last) return { limited: false };
    const elapsed = Date.now() - last;
    if (elapsed < this.rateLimitMs) {
      return { limited: true, retryAfterMs: this.rateLimitMs - elapsed };
    }
    return { limited: false };
  }

  /**
   * Execute a command string with full lifecycle management.
   * @returns {Promise<{ success: boolean, stdout?: string, stderr?: string, error?: string }>}
   */
  execute(actionId, command) {
    return new Promise(async (resolve) => {
      // ── Concurrency gate ──
      if (this._runningProcesses.size >= this.maxConcurrent) {
        return resolve({
          success: false,
          error: `Concurrency limit reached (${this.maxConcurrent} processes running). Try again shortly.`
        });
      }

      // ── Create temp script ──
      const scriptId = crypto.randomBytes(8).toString("hex");
      const scriptPath = path.join(os.tmpdir(), `corely_${scriptId}.sh`);
      try {
        await fs.writeFile(scriptPath, command, { mode: 0o700 });
      } catch (e) {
        return resolve({ success: false, error: "Failed to write temp script." });
      }

      // ── Stamp the execution time ──
      this._lastExecTime.set(actionId, Date.now());

      // ── Spawn the process ──
      const child = exec(`bash ${scriptPath}`, {
        timeout: this.processTimeoutMs,
        maxBuffer: this.maxBuffer,
        windowsHide: true,
        killSignal: "SIGTERM",
      }, (error, stdout, stderr) => {
        
        // Cleanup script
        fs.unlink(scriptPath).catch(() => {});

        // Process finished — remove from tracking set
        this._runningProcesses.delete(child);

        if (error) {
          // Distinguish timeout kills from real errors
          if (error.killed) {
            console.warn(`[CommandManager] Process for action ${actionId} killed (timeout ${this.processTimeoutMs}ms)`);
            return resolve({ success: false, error: "Process timed out and was killed." });
          }
          console.error(`[CommandManager] Exec error for action ${actionId}:`, error.message);
          return resolve({ success: false, error: error.message });
        }

        if (stdout) console.log(`[CommandManager] Action ${actionId} stdout:`, stdout.trim().substring(0, 200));
        if (stderr) console.warn(`[CommandManager] Action ${actionId} stderr:`, stderr.trim().substring(0, 200));

        resolve({ success: true, stdout: stdout?.trim(), stderr: stderr?.trim() });
      });

      // Track the child so we can enforce the concurrency cap
      this._runningProcesses.add(child);

      // Safety net: if the child somehow survives past 2× the timeout, force-kill it
      const safetyTimer = setTimeout(() => {
        if (!child.killed && child.exitCode === null) {
          console.error(`[CommandManager] Safety kill triggered for action ${actionId}`);
          child.kill("SIGKILL");
        }
      }, this.processTimeoutMs * 2);
      safetyTimer.unref(); // Don't prevent Node from exiting

      // Clean up the safety timer if the child exits normally
      child.on("exit", () => clearTimeout(safetyTimer));
    });
  }

  /**
   * How many processes are currently running.
   */
  get activeCount() {
    return this._runningProcesses.size;
  }

  /**
   * Periodic cleanup of stale rate-limit entries to prevent unbounded Map growth
   * when actions are deleted but their IDs linger in the map.
   */
  _cleanup() {
    const now = Date.now();
    const staleThreshold = this.rateLimitMs * 10; // 30 seconds by default
    for (const [id, ts] of this._lastExecTime) {
      if (now - ts > staleThreshold) {
        this._lastExecTime.delete(id);
      }
    }
  }

  /**
   * Graceful shutdown — kill all running processes and clear intervals.
   */
  destroy() {
    clearInterval(this._cleanupInterval);
    for (const child of this._runningProcesses) {
      if (!child.killed) child.kill("SIGTERM");
    }
    this._runningProcesses.clear();
    this._lastExecTime.clear();
  }
}

// Singleton instance used by all routes
const commandManager = new CommandManager({
  rateLimitMs: 3000,
  processTimeoutMs: 15000,
  maxBuffer: 512 * 1024,
  maxConcurrent: 5,
});

// Graceful shutdown on process exit
process.on("SIGINT", () => commandManager.destroy());
process.on("SIGTERM", () => commandManager.destroy());

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────
async function getActions() {
  try {
    const data = await fs.readFile(DATA_FILE, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    if (err.code === "ENOENT") {
      await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
      await fs.writeFile(DATA_FILE, "[]", "utf-8");
      return [];
    }
    throw err;
  }
}

async function getSettings() {
  try {
    const data = await fs.readFile(SETTINGS_FILE, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    if (err.code === "ENOENT") {
      const defaultSettings = { accentColor: "#8040ff" };
      await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
      await fs.writeFile(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 2), "utf-8");
      return defaultSettings;
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
//  Routes
// ─────────────────────────────────────────────────────────────

// GET settings
router.get("/api/settings", async (req, res) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: "Failed to read settings." });
  }
});

// POST update settings
router.post("/api/settings", async (req, res) => {
  try {
    const current = await getSettings();
    const updated = { ...current, ...req.body };
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(updated, null, 2), "utf-8");
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to save settings." });
  }
});

// GET all actions
router.get("/api/actions", async (req, res) => {
  try {
    const actions = await getActions();
    res.json(actions);
  } catch (err) {
    console.error("Error reading actions:", err);
    res.status(500).json({ error: "Failed to read actions." });
  }
});

// POST new action
router.post("/api/actions", async (req, res) => {
  try {
    const { name, icon, command, iconSvg } = req.body;
    if (!name || !icon || !command || !iconSvg) {
      return res.status(400).json({ error: "Name, icon, iconSvg, and command are required." });
    }

    // Basic input length guards
    if (name.length > 64) return res.status(400).json({ error: "Name too long (max 64 chars)." });
    if (icon.length > 64) return res.status(400).json({ error: "Icon name too long (max 64 chars)." });
    if (command.length > 1024) return res.status(400).json({ error: "Command too long (max 1024 chars)." });
    if (iconSvg.length > 32768) return res.status(400).json({ error: "Icon SVG too large (max 32KB)." });

    // Save SVG for offline usage
    // Sanitize icon name to prevent path traversal
    const safeName = icon.replace(/[^a-z0-9\-]/gi, "_");
    const iconPath = path.join(process.cwd(), "data", "cached-icons", `${safeName}.svg`);
    await fs.mkdir(path.dirname(iconPath), { recursive: true });
    await fs.writeFile(iconPath, iconSvg, "utf-8");

    const actions = await getActions();
    const newAction = {
      id: Date.now().toString(),
      name,
      icon: safeName,
      command,
    };

    actions.push(newAction);
    await fs.writeFile(DATA_FILE, JSON.stringify(actions, null, 2), "utf-8");

    res.status(201).json(newAction);
  } catch (err) {
    console.error("Error creating action:", err);
    res.status(500).json({ error: "Failed to create action." });
  }
});

// DELETE action
router.delete("/api/actions/:id", async (req, res) => {
  try {
    const actions = await getActions();
    const actionToDelete = actions.find((a) => a.id === req.params.id);

    if (!actionToDelete) {
      return res.status(404).json({ error: "Action not found." });
    }

    const filteredActions = actions.filter((a) => a.id !== req.params.id);
    await fs.writeFile(DATA_FILE, JSON.stringify(filteredActions, null, 2), "utf-8");

    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting action:", err);
    res.status(500).json({ error: "Failed to delete action." });
  }
});

// POST trigger uninstall
router.post("/api/actions/uninstall", async (req, res) => {
  try {
    res.json({ success: true, message: "Uninstalling corely..." });
    
    // Give express 2 seconds to flush the response, then execute rm -rf on the CWD and exit.
    setTimeout(() => {
       const dir = process.cwd();
       exec(`rm -rf "${dir}"`, (error) => {
          process.exit(0);
       });
    }, 2000);
  } catch(e) {
    res.status(500).json({ error: "Uninstall failed" });
  }
});

// PUT reorder actions
router.put("/api/actions/reorder", async (req, res) => {
  try {
    const { order } = req.body; // Array of IDs
    if (!Array.isArray(order)) return res.status(400).json({ error: "order must be an array of IDs" });

    const actions = await getActions();
    const newActions = [];
    
    // Add existing items matching the new order
    order.forEach(id => {
      const match = actions.find(a => a.id === id);
      if (match) newActions.push(match);
    });

    // Bring over any that might have been concurrently added/missed in the UI map
    actions.forEach(a => {
      if (!newActions.find(na => na.id === a.id)) {
        newActions.push(a);
      }
    });

    await fs.writeFile(DATA_FILE, JSON.stringify(newActions, null, 2), "utf-8");
    res.json({ success: true });
  } catch (err) {
    console.error("Error reordering actions:", err);
    res.status(500).json({ error: "Failed to reorder actions." });
  }
});

// GET proxy for unpkg meta (bypasses browser CORS on 302 redirects)
router.get("/api/icons/meta", async (req, res) => {
  try {
    const response = await fetch("https://unpkg.com/lucide-static@latest/icons/?meta");
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to proxy unpkg meta:", err);
    res.status(500).json({ error: "Failed to fetch icon meta list" });
  }
});

// POST execute action
router.post("/api/actions/:id/execute", async (req, res) => {
  const actionId = req.params.id;

  // ── Rate-limit check ──
  const { limited, retryAfterMs } = commandManager.isRateLimited(actionId);
  if (limited) {
    return res.status(429).json({
      error: "Rate limit exceeded. Please wait.",
      retryAfterMs,
    });
  }

  try {
    const actions = await getActions();
    const action = actions.find((a) => a.id === actionId);

    if (!action) {
      return res.status(404).json({ error: "Action not found." });
    }

    // Fire-and-forget with managed lifecycle
    const result = await commandManager.execute(actionId, action.command);

    if (result.success) {
      res.json({ success: true, message: "Execution completed." });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (err) {
    console.error("Error executing action:", err);
    res.status(500).json({ error: "Failed to lookup/execute action." });
  }
});

export default router;
