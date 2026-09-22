// =======================================
// KLP Frontend Shared Library
// - API client (Email + PIN auth)
// - Shared navbar / project switcher
// - Toasts, HTML escaping, status badges
// =======================================

const API_BASE = "/api";

// ---------------------------------------
// Session helpers
// ---------------------------------------
function getAuthHeaders() {
  const email = sessionStorage.getItem("klp_email");
  const pin = sessionStorage.getItem("klp_pin");

  if (!email || !pin) return null;

  return {
    "x-user-email": email,
    "x-user-pin": pin
  };
}

function myEmail() {
  return sessionStorage.getItem("klp_email") || "";
}

function redirectToLogin() {
  // replace() avoids back-button returning to protected pages
  window.location.replace("login.html");
}

// ---------------------------------------
// Low-level API helper
// ---------------------------------------
async function api(path, options = {}) {
  const authHeaders = getAuthHeaders();
  if (!authHeaders) {
    redirectToLogin();
    return null;
  }

  const headers = {
    ...authHeaders,
    ...(options.headers || {})
  };

  // optional project context
  const projectId = sessionStorage.getItem("activeProjectId");
  if (projectId) {
    headers["x-project-id"] = projectId;
  }

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers
    });
  } catch (err) {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }

  if (res.status === 401 || res.status === 403) {
    sessionStorage.clear();
    redirectToLogin();
    return null;
  }

  if (res.status === 204) return null;

  if (!res.ok) {
    let message = "API error";
    try {
      const body = await res.json();
      message = body.error || body.message || message;
    } catch (e) {
      // non-JSON error body
    }
    throw new Error(message);
  }

  return res.json();
}

// ---------------------------------------
// Auth
// ---------------------------------------
async function login(email, pin) {
  let res;
  try {
    res = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, pin })
    });
  } catch (err) {
    throw new Error("Could not reach the server. Please try again.");
  }

  if (!res.ok) {
    throw new Error("Invalid email or PIN");
  }

  sessionStorage.setItem("klp_email", email);
  sessionStorage.setItem("klp_pin", pin);
}

function requireAuth() {
  if (!getAuthHeaders()) {
    redirectToLogin();
    return false;
  }
  return true;
}

function logout() {
  sessionStorage.clear();
  redirectToLogin();
}

// ---------------------------------------
// Data APIs
// ---------------------------------------
function getKnowledge() {
  return api("/knowledge");
}

function createKnowledge(payload) {
  return api("/knowledge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

function decideKnowledge(id, action) {
  // action: "approve" | "reject"
  return api("/knowledge/decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, action })
  });
}

// ---------------------------------------
// Helpers
// ---------------------------------------
function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/** Escape a value for safe interpolation into HTML. */
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Read the first matching field from an item (API schema tolerance). */
function pickField(obj, names, fallback = "") {
  if (!obj) return fallback;
  for (const name of names) {
    if (obj[name] !== undefined && obj[name] !== null && obj[name] !== "") {
      return obj[name];
    }
  }
  return fallback;
}

/** Creator / submitter of a knowledge item, across plausible API field names. */
function itemCreator(item) {
  return pickField(item, [
    "created_by", "submitted_by", "author_email", "owner_email",
    "user_email", "created_by_email", "email", "author"
  ]);
}

/** Submission timestamp, across plausible API field names. */
function itemDate(item) {
  const raw = pickField(item, ["created_at", "submitted_at", "updated_at", "date", "timestamp"]);
  if (!raw) return "";
  const d = new Date(raw);
  return isNaN(d.getTime()) ? String(raw) : d.toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric"
  });
}

/** Badge markup for a knowledge status (Approved / Pending / Draft / Rejected / Archived). */
function statusBadge(status) {
  const s = String(status || "Unknown");
  const key = s.toLowerCase();
  const known = ["approved", "pending", "draft", "rejected", "archived"];
  const cls = known.includes(key) ? `status-${key}` : "status-unknown";
  return `<span class="badge status-badge ${cls}">${esc(s)}</span>`;
}

/** Short excerpt of the knowledge description for cards/lists. */
function excerpt(item, max = 140) {
  const text = String(pickField(item, ["description", "details", "body"], "")).trim();
  if (!text) return "";
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}

// ---------------------------------------
// Toast notifications (no Bootstrap JS needed)
// ---------------------------------------
function toast(message, type = "info") {
  let host = document.getElementById("klp-toasts");
  if (!host) {
    host = document.createElement("div");
    host.id = "klp-toasts";
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }

  const el = document.createElement("div");
  el.className = `klp-toast toast-${type}`;
  el.setAttribute("role", "status");
  el.textContent = message;
  host.appendChild(el);

  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 0.25s ease";
    setTimeout(() => el.remove(), 250);
  }, 3200);
}

// ---------------------------------------
// Shared UI: loading / empty / error states
// ---------------------------------------
function loadingCards(count = 3) {
  let html = "";
  for (let i = 0; i < count; i++) {
    html += `
      <div class="col-md-4">
        <div class="glass-card h-100 p-3">
          <div class="klp-skeleton mb-2" style="width: 70%; height: 1.2rem;"></div>
          <div class="klp-skeleton mb-3" style="width: 45%;"></div>
          <div class="klp-skeleton" style="width: 30%; height: 1.4rem;"></div>
        </div>
      </div>`;
  }
  return html;
}

function emptyStateHTML(icon, title, subtitle, actionHTML = "") {
  return `
    <div class="glass-card klp-empty w-100">
      <span class="klp-empty-icon">${icon}</span>
      <div class="fw-semibold mb-1">${esc(title)}</div>
      <div class="mb-3">${esc(subtitle)}</div>
      ${actionHTML}
    </div>`;
}

function errorStateHTML(message) {
  return `
    <div class="glass-card klp-empty w-100">
      <span class="klp-empty-icon">⚠️</span>
      <div class="fw-semibold mb-1">Something went wrong</div>
      <div class="mb-3">${esc(message)}</div>
      <button class="btn btn-outline-light btn-sm" onclick="location.reload()">Retry</button>
    </div>`;
}

// ---------------------------------------
// Shared navbar
// ---------------------------------------
const KLP_NAV_ITEMS = [
  { href: "index.html", key: "home", label: "Home" },
  { href: "submit.html", key: "submit", label: "Submit" },
  { href: "my-items.html", key: "my-items", label: "My Knowledge" },
  { href: "approval.html", key: "approvals", label: "Approvals" }
];

/**
 * Render the shared navbar into #klp-navbar (created if missing).
 * `active` is one of: home | submit | my-items | approvals | admin
 */
function renderNavbar(active) {
  let nav = document.getElementById("klp-navbar");
  if (!nav) {
    nav = document.createElement("nav");
    nav.id = "klp-navbar";
    nav.className = "navbar navbar-expand-lg navbar-dark klp-nav mb-4";
    document.body.prepend(nav);
  }

  const links = KLP_NAV_ITEMS.map(
    (item) => `
      <li class="nav-item">
        <a class="nav-link ${item.key === active ? "active" : ""}" href="${item.href}">${item.label}</a>
      </li>`
  ).join("");

  nav.innerHTML = `
    <div class="container-fluid">
      <a class="navbar-brand" href="index.html">KLP</a>
      <div class="d-flex flex-wrap align-items-center gap-2 mt-2 mt-lg-0">
        <ul class="navbar-nav d-flex flex-wrap align-items-center gap-1">
          ${links}
          <li class="nav-item" id="adminNavItem" style="display: none;">
            <a class="nav-link ${active === "admin" ? "active" : ""}" href="admin.html">Admin</a>
          </li>
        </ul>
        <select
          id="projectSwitcher"
          class="form-select form-select-sm"
          style="width: 200px; display: none;"
          aria-label="Switch project"
        ></select>
        <span id="klpDemoBadge" class="klp-demo-badge" style="display: none;">Demo</span>
        <span id="klpUserChip" class="klp-user-chip" title="${esc(myEmail())}">${esc(myEmail())}</span>
        <button class="btn btn-sm btn-danger" onclick="logout()">Logout</button>
      </div>
    </div>`;
}

/**
 * Initialize shared chrome: auth gate, navbar, admin visibility,
 * project switcher. Returns the /me payload (or null).
 *
 * Usage on every page:
 *   initPage("home").then((me) => { ...load data... });
 */
async function initPage(active) {
  if (!requireAuth()) return null;

  renderNavbar(active);

  let me = null;
  try {
    me = await api("/me");
  } catch (err) {
    console.error("Failed to load /me:", err);
  }

  if (me) {
    if (me.isOwner) {
      const adminItem = document.getElementById("adminNavItem");
      if (adminItem) adminItem.style.display = "";
    }
    if (me.isDemo || me.demo) {
      const demoBadge = document.getElementById("klpDemoBadge");
      if (demoBadge) demoBadge.style.display = "";
    }
  }

  try {
    await initProjectSwitcher();
  } catch (err) {
    console.error("Failed to load projects:", err);
  }

  return me;
}

async function initProjectSwitcher() {
  const projects = await api("/projects");
  const switcher = document.getElementById("projectSwitcher");
  if (!switcher) return;

  if (!projects || projects.length === 0) return;

  const saved = sessionStorage.getItem("activeProjectId");

  if (projects.length === 1) {
    // Keep project context explicit even for single-project users.
    sessionStorage.setItem("activeProjectId", String(projects[0].id));
    return;
  }

  switcher.style.display = "inline-block";
  switcher.innerHTML = "";

  projects.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.role})`;
    switcher.appendChild(opt);
  });

  const savedIsValid = saved && projects.some((p) => String(p.id) === String(saved));
  switcher.value = savedIsValid ? saved : projects[0].id;
  sessionStorage.setItem("activeProjectId", switcher.value);

  switcher.onchange = () => {
    sessionStorage.setItem("activeProjectId", switcher.value);
    location.reload();
  };
}

// ---------------------------------------
// Param helper (re-exported for pages)
// ---------------------------------------
// getParam is defined above.
