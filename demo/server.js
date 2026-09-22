#!/usr/bin/env node
/**
 * KLP Demo / Dev Server  (zero dependencies)
 * ---------------------------------------------------------------
 * Serves the KLP static frontend and a mock implementation of the
 * Cloudflare Worker API (`/api/*`) with in-memory demo data, so the
 * tool can be run and demoed without the Cloudflare backend.
 *
 *   node demo/server.js        → http://localhost:3000
 *
 * Demo accounts (PIN 1234):
 *   owner@klp.test   – owner of "KLP Internal" + "KLP-Test-Project"
 *   member@klp.test  – member of "KLP-Test-Project"
 *
 * Data lives in memory and resets when the server restarts.
 * This server is for local development / demos ONLY — the PIN check
 * is intentionally trivial and must never be used in production.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

// ---------------------------------------------------------------
// Seed data (mirrors the live demo screenshots)
// ---------------------------------------------------------------
const now = Date.now();
const daysAgo = (n) => new Date(now - n * 86400000).toISOString();

const db = {
  seq: 100,
  users: [
    { id: 1, email: "owner@klp.test", pin: "1234", role: "owner" },
    { id: 2, email: "member@klp.test", pin: "1234", role: "member" }
  ],
  projects: [
    { id: 1, name: "KLP Internal" },
    { id: 2, name: "KLP-Test-Project" }
  ],
  // memberships: user × project roles
  memberships: [
    { user_id: 1, project_id: 1, role: "owner" },
    { user_id: 1, project_id: 2, role: "owner" },
    { user_id: 2, project_id: 2, role: "member" }
  ],
  knowledge: [
    {
      id: 1,
      project_id: 1,
      title: "Testing submit knowledge",
      system: "KLP app",
      process_area: "IT",
      description:
        "Smoke-test entry for the KLP submission flow.\n\nSteps:\n1. Fill the submit form.\n2. Save a draft or submit for review.\n3. Approve it from the approval queue.\n\nThis item was approved successfully.",
      status: "Approved",
      created_by: "owner@klp.test",
      created_at: daysAgo(6)
    },
    {
      id: 2,
      project_id: 1,
      title: "Forced test entry",
      system: "Test System",
      process_area: "IT",
      description:
        "Seeded directly through the API to test forced entries. Kept for historical reference; archived after testing concluded.",
      status: "Archived",
      created_by: "member@klp.test",
      created_at: daysAgo(5)
    },
    {
      id: 3,
      project_id: 1,
      title: "Server restart order",
      system: "Windows Server",
      process_area: "IT",
      description:
        "Critical: the app server MUST be restarted before the database server.\n\n1. Drain connections on APP-01.\n2. Restart APP-01, wait for healthcheck.\n3. Restart DB-01.\n4. Verify nightly jobs are re-enabled.\n\nNever restart DB-01 first — it causes a split-brain on the session store.",
      status: "Draft",
      created_by: "owner@klp.test",
      created_at: daysAgo(2)
    },
    {
      id: 4,
      project_id: 2,
      title: "Project 2 – First Knowledge",
      system: "KLP-Test-Project tooling",
      process_area: "Operations",
      description:
        "First knowledge item captured in the test project. Placeholder content used to validate cross-project approval flows.",
      status: "Draft",
      created_by: "owner@klp.test",
      created_at: daysAgo(1)
    },
    {
      id: 5,
      project_id: 1,
      title: "Monthly finance close checklist",
      system: "ERP",
      process_area: "Finance",
      description:
        "Close calendar and reconciliations for month-end.\n\n- Day 1: lock subledgers\n- Day 2: run reconciliations (FIN-REP-01)\n- Day 3: controller review\n\nSign-off goes to the #finance-close channel.",
      status: "Pending",
      created_by: "member@klp.test",
      created_at: daysAgo(0)
    }
  ]
};

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon"
};

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "X-KLP-Demo": "1"
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function findUser(req) {
  const email = String(req.headers["x-user-email"] || "").toLowerCase();
  const pin = String(req.headers["x-user-pin"] || "");
  return db.users.find((u) => u.email === email && u.pin === pin) || null;
}

function projectsFor(user) {
  return db.memberships
    .filter((m) => m.user_id === user.id)
    .map((m) => {
      const p = db.projects.find((p) => p.id === m.project_id);
      return p ? { id: p.id, name: p.name, role: m.role } : null;
    })
    .filter(Boolean);
}

function activeProjectId(user, req) {
  const header = Number(req.headers["x-project-id"]);
  const mine = projectsFor(user).map((p) => p.id);
  if (header && mine.includes(header)) return header;
  return mine[0] || null;
}

function projectItems(user, req) {
  const pid = activeProjectId(user, req);
  return db.knowledge.filter((k) => k.project_id === pid);
}

function sanitizeItem(k) {
  // The list/detail API returns the full item shape used by the frontend.
  return {
    id: k.id,
    title: k.title,
    system: k.system,
    process_area: k.process_area,
    description: k.description,
    status: k.status,
    created_by: k.created_by,
    created_at: k.created_at,
    project_name: (db.projects.find((p) => p.id === k.project_id) || {}).name
  };
}

const QUEUABLE = new Set(["draft", "pending"]);

// ---------------------------------------------------------------
// API router
// ---------------------------------------------------------------
async function handleApi(req, res, pathname) {
  // ---- public endpoints ----
  if (pathname === "/api/health") {
    return json(res, 200, { ok: true, demo: true, service: "klp-demo" });
  }

  if (pathname === "/api/login" && req.method === "POST") {
    const body = await readBody(req).catch(() => null);
    if (!body) return json(res, 400, { error: "Invalid JSON" });
    const email = String(body.email || "").toLowerCase().trim();
    const pin = String(body.pin || "").trim();
    const user = db.users.find((u) => u.email === email && u.pin === pin);
    if (!user) return json(res, 401, { error: "Invalid email or PIN" });
    return json(res, 200, { ok: true, email: user.email });
  }

  // ---- authenticated endpoints ----
  const user = findUser(req);
  if (!user) return json(res, 401, { error: "Unauthorized" });

  if (pathname === "/api/me" && req.method === "GET") {
    return json(res, 200, {
      email: user.email,
      role: user.role,
      isOwner: user.role === "owner",
      isDemo: true
    });
  }

  if (pathname === "/api/projects" && req.method === "GET") {
    return json(res, 200, projectsFor(user));
  }

  if (pathname === "/api/knowledge" && req.method === "GET") {
    const items = projectItems(user, req)
      .map(sanitizeItem)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return json(res, 200, items);
  }

  if (pathname === "/api/knowledge" && req.method === "POST") {
    const body = await readBody(req).catch(() => null);
    if (!body) return json(res, 400, { error: "Invalid JSON" });
    if (!body.title || !String(body.title).trim()) {
      return json(res, 400, { error: "Title is required" });
    }
    const pid = activeProjectId(user, req);
    if (!pid) return json(res, 400, { error: "No project context" });

    const requested = String(body.status || "Draft");
    // Only accept known workflow states; anything else becomes Draft.
    const status = ["Draft", "Pending"].includes(requested) ? requested : "Draft";

    const item = {
      id: ++db.seq,
      project_id: pid,
      title: String(body.title).trim().slice(0, 200),
      system: String(body.system || "").trim().slice(0, 120),
      process_area: String(body.process_area || "Other").slice(0, 60),
      description: String(body.description || "").trim().slice(0, 5000),
      status,
      created_by: user.email,
      created_at: new Date().toISOString()
    };
    db.knowledge.push(item);
    return json(res, 201, sanitizeItem(item));
  }

  if (pathname === "/api/knowledge/decision" && req.method === "POST") {
    const body = await readBody(req).catch(() => null);
    if (!body) return json(res, 400, { error: "Invalid JSON" });

    const item = db.knowledge.find((k) => k.id === Number(body.id));
    if (!item) return json(res, 404, { error: "Item not found" });

    // Approvals require owner on the item's project
    const membership = db.memberships.find(
      (m) => m.user_id === user.id && m.project_id === item.project_id
    );
    if (!membership || membership.role !== "owner") {
      return json(res, 403, { error: "Not allowed to decide on this item" });
    }

    if (body.action === "approve") item.status = "Approved";
    else if (body.action === "reject") item.status = "Rejected";
    else return json(res, 400, { error: "Unknown action" });

    return json(res, 200, sanitizeItem(item));
  }

  if (pathname === "/api/approvals" && req.method === "GET") {
    // Items awaiting a decision in projects where the user is an owner.
    const owned = db.memberships
      .filter((m) => m.user_id === user.id && m.role === "owner")
      .map((m) => m.project_id);

    const queue = db.knowledge
      .filter((k) => owned.includes(k.project_id) && QUEUABLE.has(String(k.status).toLowerCase()))
      .map(sanitizeItem)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return json(res, 200, queue);
  }

  if (pathname === "/api/admin/users" && req.method === "POST") {
    if (user.role !== "owner") {
      return json(res, 403, { error: "Owner role required" });
    }
    const body = await readBody(req).catch(() => null);
    if (!body) return json(res, 400, { error: "Invalid JSON" });

    const email = String(body.email || "").toLowerCase().trim();
    const pin = String(body.pin || "").trim();
    const role = ["owner", "member"].includes(body.role) ? body.role : "member";

    if (!email.includes("@")) return json(res, 400, { error: "Valid email required" });
    if (!/^\d{4}$/.test(pin)) return json(res, 400, { error: "PIN must be 4 digits" });
    if (db.users.some((u) => u.email === email)) {
      return json(res, 409, { error: "User already exists" });
    }

    const created = { id: ++db.seq, email, pin, role };
    db.users.push(created);
    // Give new users membership in every project (demo convenience)
    db.projects.forEach((p) =>
      db.memberships.push({ user_id: created.id, project_id: p.id, role: "member" })
    );
    return json(res, 201, { ok: true, email: created.email, role: created.role });
  }

  return json(res, 404, { error: "Not found" });
}

// ---------------------------------------------------------------
// Static file server
// ---------------------------------------------------------------
function serveStatic(req, res, pathname) {
  let rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const file = path.resolve(ROOT, rel);

  // Path-traversal guard
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, "index.html")) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
}

// ---------------------------------------------------------------
// Server
// ---------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (pathname.startsWith("/api/")) {
      return await handleApi(req, res, pathname.replace(/\/$/, ""));
    }
    return serveStatic(req, res, pathname);
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: err.message || "Server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log("─────────────────────────────────────────────────");
  console.log("  KLP DEMO server (mock API — not production!)");
  console.log(`  → http://localhost:${PORT}`);
  console.log("  Demo logins (PIN 1234):");
  console.log("    owner@klp.test   (owner)");
  console.log("    member@klp.test  (member)");
  console.log("─────────────────────────────────────────────────");
});
