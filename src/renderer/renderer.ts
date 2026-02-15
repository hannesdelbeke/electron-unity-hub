type ProjectEntry = {
  id: string;
  nickname: string;
  name: string;
  path: string;
  unityVersion: string;
  unityExe: string;
  lastOpenedIso: string;
  autoGetLatest?: boolean;
  cloudRepo?: string;
  cloneUrl?: string;
  repoSizeBytes?: number;
};

type VcsStatus = {
  kind: string;
  branchOrStream: string;
  state: string;
  localChangesCount: number;
  incomingCount: number;
  outgoingCount: number;
  conflictCount: number;
  infoMessage?: string;
};

type UnityInstall = {
  version: string;
  path: string;
  source: string;
  exists: boolean;
};

type ThemePreference = "system" | "dark" | "light";
type StatusTone = "success" | "warning" | "error" | "info";
type SortDirection = "asc" | "desc";
type ProjectSortKey = "displayName" | "path" | "unityVersion" | "vcs" | "branchOrStream" | "lastOpenedIso" | "sizeBytes" | "status";
type InstallSortKey = "version" | "path" | "source" | "status";

type ProjectTableRow = {
  project: ProjectEntry;
  vcs: VcsStatus;
  isMissing: boolean;
  isOpen: boolean;
  isCloud: boolean;
  isInstalled: boolean;
  remoteUrl: string;
  modifiedIso: string;
  sizeBytes: number;
  iconDataUrl: string;
};

type ActionResult = {
  ok: boolean;
  message: string;
  conflict?: boolean;
};

const tbody = document.querySelector<HTMLTableSectionElement>("#projects-table tbody");
const installsTbody = document.querySelector<HTMLTableSectionElement>("#installs-table tbody");
const statusEl = document.getElementById("status");
const settingsStatusEl = document.getElementById("settings-status");
const searchInput = document.getElementById("search") as HTMLInputElement | null;
const searchInstallsInput = document.getElementById("search-installs") as HTMLInputElement | null;
const addToggle = document.getElementById("add-toggle") as HTMLButtonElement | null;
const addMenu = document.getElementById("add-menu") as HTMLDivElement | null;
const addToggleInstalls = document.getElementById("add-toggle-installs") as HTMLButtonElement | null;
const addMenuInstalls = document.getElementById("add-menu-installs") as HTMLDivElement | null;

const diskDialog = document.getElementById("disk-dialog") as HTMLDialogElement | null;
const repoDialog = document.getElementById("repo-dialog") as HTMLDialogElement | null;
const projectSettingsDialog = document.getElementById("project-settings-dialog") as HTMLDialogElement | null;

const diskPath = document.getElementById("disk-path") as HTMLInputElement | null;
const diskNickname = document.getElementById("disk-nickname") as HTMLInputElement | null;
const diskUnityExe = document.getElementById("disk-unity-exe") as HTMLInputElement | null;

const repoUrl = document.getElementById("repo-url") as HTMLInputElement | null;
const repoBranch = document.getElementById("repo-branch") as HTMLInputElement | null;
const repoTarget = document.getElementById("repo-target") as HTMLInputElement | null;
const repoNickname = document.getElementById("repo-nickname") as HTMLInputElement | null;
const repoUnityExe = document.getElementById("repo-unity-exe") as HTMLInputElement | null;

const settingsDefaultUnityExe = document.getElementById("settings-default-unity-exe") as HTMLInputElement | null;
const settingsTheme = document.getElementById("settings-theme") as HTMLSelectElement | null;
const settingsDefaultCloneDir = document.getElementById("settings-default-clone-dir") as HTMLInputElement | null;
const settingsDisableRenderThrottling =
  document.getElementById("settings-disable-render-throttling") as HTMLInputElement | null;
const settingsAutoGetLatestDefault =
  document.getElementById("settings-auto-get-latest-default") as HTMLInputElement | null;
const projectSettingsNickname = document.getElementById("project-settings-nickname") as HTMLInputElement | null;
const projectSettingsAutoGetLatest = document.getElementById("project-settings-auto-get-latest") as HTMLInputElement | null;
const settingsGitInstallBtn = document.getElementById("settings-git-install") as HTMLButtonElement | null;
const settingsGhInstallBtn = document.getElementById("settings-gh-install") as HTMLButtonElement | null;
const settingsGhAuthBtn = document.getElementById("settings-gh-auth") as HTMLButtonElement | null;
const settingsGithubRefreshBtn = document.getElementById("settings-github-refresh-cloud") as HTMLButtonElement | null;
const settingsGlabInstallBtn = document.getElementById("settings-glab-install") as HTMLButtonElement | null;
const settingsGlabAuthBtn = document.getElementById("settings-glab-auth") as HTMLButtonElement | null;
const settingsGitlabRefreshBtn = document.getElementById("settings-gitlab-refresh-cloud") as HTMLButtonElement | null;
const settingsHubInstallBtn = document.getElementById("settings-hub-install") as HTMLButtonElement | null;
const settingsGhInstalledLine = document.getElementById("settings-gh-installed-line");
const settingsGhConnectedLine = document.getElementById("settings-gh-connected-line");
const settingsGhConnectedText = document.getElementById("settings-gh-connected-text");
const settingsGlabInstalledLine = document.getElementById("settings-glab-installed-line");
const settingsGlabConnectedLine = document.getElementById("settings-glab-connected-line");
const settingsGlabConnectedText = document.getElementById("settings-glab-connected-text");
const settingsGitInstalledLine = document.getElementById("settings-git-installed-line");
const settingsHubInstalledLine = document.getElementById("settings-hub-installed-line");
const settingsGitMissingLine = document.getElementById("settings-git-missing-line");
const settingsGhMissingLine = document.getElementById("settings-gh-missing-line");
const settingsGhAuthMissingLine = document.getElementById("settings-gh-auth-missing-line");
const settingsGlabMissingLine = document.getElementById("settings-glab-missing-line");
const settingsGlabAuthMissingLine = document.getElementById("settings-glab-auth-missing-line");
const settingsHubMissingLine = document.getElementById("settings-hub-missing-line");
const settingsGitInstallLoading = document.getElementById("settings-git-install-loading");
const settingsGhInstallLoading = document.getElementById("settings-gh-install-loading");
const settingsHubInstallLoading = document.getElementById("settings-hub-install-loading");
const settingsGlabInstallLoading = document.getElementById("settings-glab-install-loading");

const tabProjects = document.getElementById("tab-projects");
const tabInstalls = document.getElementById("tab-installs");
const tabSettings = document.getElementById("tab-settings");

const viewProjects = document.getElementById("view-projects");
const viewInstalls = document.getElementById("view-installs");
const viewSettings = document.getElementById("view-settings");

let projects: ProjectEntry[] = [];
let cloudProjects: ProjectEntry[] = [];
let installs: UnityInstall[] = [];
let availableUnityVersions = new Set<string>();
let selectedId = "";
let searchText = "";
let searchInstallsText = "";
let openProjectMenuId = "";
let openInstallMenuPath = "";
let editingProjectId = "";
let didInit = false;
let projectsRenderToken = 0;
const projectRowCache = new Map<string, ProjectTableRow>();
const busyProjectOps = new Map<string, string>();
let activeStatusActivities = 0;
let statusLoadingVisible = false;
let statusLoadingRestoreText = "";
let statusLoadingRestoreClassName = "";
let statusResetTimer: ReturnType<typeof setTimeout> | null = null;
let statusSetToken = 0;
let projectSort: { key: ProjectSortKey; direction: SortDirection } = { key: "lastOpenedIso", direction: "desc" };
let installSort: { key: InstallSortKey; direction: SortDirection } = { key: "version", direction: "asc" };

const defaultUnityExeKey = "unityLauncher.defaultUnityExe";
const themePreferenceKey = "unityLauncher.themePreference";
const defaultCloneDirKey = "unityLauncher.defaultCloneDir";
const autoGetLatestDefaultKey = "unityLauncher.autoGetLatestDefault";
const dismissedInstallsKey = "unityLauncher.dismissedInstalls";
const customInstallsKey = "unityLauncher.customInstalls";

type TabName = "projects" | "installs" | "settings";

function statusTargets(): HTMLElement[] {
  return [statusEl, settingsStatusEl].filter((x): x is HTMLElement => Boolean(x));
}

function currentStatusTarget(): HTMLElement | null {
  if (viewSettings?.classList.contains("active") && settingsStatusEl) {
    return settingsStatusEl;
  }
  if (statusEl) {
    return statusEl;
  }
  return settingsStatusEl ?? null;
}

function setStatus(msg: string, tone: StatusTone = "success", autoResetMs = 0): void {
  const normalizedMessage = msg.replace(/\s+/g, " ").trim();
  statusSetToken += 1;
  const tokenAtSet = statusSetToken;
  if (statusResetTimer) {
    clearTimeout(statusResetTimer);
    statusResetTimer = null;
  }
  const targets = statusTargets();
  targets.forEach((target) => {
    target.textContent = normalizedMessage;
    target.classList.remove("status-success", "status-warning", "status-error", "status-info", "status-loading");
    target.classList.add(`status-${tone}`);
  });
  if (autoResetMs > 0) {
    statusResetTimer = setTimeout(() => {
      if (tokenAtSet !== statusSetToken) {
        return;
      }
      statusTargets().forEach((target) => {
        target.textContent = "Ready";
        target.classList.remove("status-success", "status-warning", "status-error", "status-info", "status-loading");
        target.classList.add("status-info");
      });
      statusResetTimer = null;
    }, autoResetMs);
  }
}

function setActionStatus(result: ActionResult, successAutoResetMs = 4000, errorAutoResetMs = 10000): void {
  setStatus(result.message, result.ok ? "success" : "error", result.ok ? successAutoResetMs : errorAutoResetMs);
}

async function withActivity<T>(message: string, task: () => Promise<T>): Promise<T> {
  activeStatusActivities += 1;
  const target = currentStatusTarget();
  const previousText = target?.textContent ?? "";
  const previousClassName = target?.className ?? "";
  let shown = false;
  let timerCompleted = false;

  const timer = setTimeout(() => {
    timerCompleted = true;
    if (activeStatusActivities <= 0 || statusLoadingVisible) {
      return;
    }
    shown = true;
    statusLoadingVisible = true;
    statusLoadingRestoreText = previousText;
    statusLoadingRestoreClassName = previousClassName;
    if (target) {
      target.textContent = message;
      target.classList.remove("status-success", "status-warning", "status-error", "status-info", "status-loading");
      target.classList.add("status-info", "status-loading");
    }
  }, 300);

  try {
    return await task();
  } finally {
    clearTimeout(timer);
    if (!timerCompleted) {
      shown = false;
    }
    activeStatusActivities = Math.max(0, activeStatusActivities - 1);
    if (target && shown && activeStatusActivities === 0 && target.classList.contains("status-loading")) {
      target.textContent = statusLoadingRestoreText;
      target.className = statusLoadingRestoreClassName;
      statusLoadingVisible = false;
    }
    if (activeStatusActivities === 0) {
      statusLoadingVisible = false;
    }
  }
}

function applyTheme(pref: ThemePreference): void {
  const root = document.documentElement;
  if (pref === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", pref);
  }
}

function activateTab(tab: TabName): void {
  tabProjects?.classList.toggle("active", tab === "projects");
  tabInstalls?.classList.toggle("active", tab === "installs");
  tabSettings?.classList.toggle("active", tab === "settings");

  viewProjects?.classList.toggle("active", tab === "projects");
  viewInstalls?.classList.toggle("active", tab === "installs");
  viewSettings?.classList.toggle("active", tab === "settings");
}

function svgIcon(name: "warning" | "arrowDown" | "arrowUp" | "dot" | "spinner" | "moreHorizontal"): string {
  switch (name) {
    case "warning":
      return "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 9v4m0 4h.01M10.29 3.86l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.71-3.14l-8-14a2 2 0 0 0-3.42 0z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>";
    case "arrowDown":
      return "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 5v14m0 0-5-5m5 5 5-5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>";
    case "arrowUp":
      return "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 19V5m0 0-5 5m5-5 5 5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>";
    case "spinner":
      return "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M21 12a9 9 0 1 1-2.64-6.36\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"/></svg>";
    default:
      return "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"2.5\" fill=\"currentColor\"/></svg>";
  }
}

function metricWithIcon(
  icon: "arrowDown" | "arrowUp" | "dot",
  value: string | number,
  title: string,
  iconAfter = false,
  hideIcon = false,
): string {
  const numericValue = typeof value === "number" ? value : Number.parseInt(String(value).replace(/[^\d-]/g, ""), 10);
  const isActive = Number.isFinite(numericValue) && numericValue > 0;
  if (hideIcon) {
    return `<span class="vcs-metric${isActive ? " active" : ""}" title="${title}"><span>${value}</span></span>`;
  }
  if (iconAfter) {
    return `<span class="vcs-metric${isActive ? " active" : ""}" title="${title}"><span>${value}</span><span class="vcs-metric-icon">${svgIcon(icon)}</span></span>`;
  }
  return `<span class="vcs-metric${isActive ? " active" : ""}" title="${title}"><span class="vcs-metric-icon">${svgIcon(icon)}</span><span>${value}</span></span>`;
}

function formatVcsText(vcs: VcsStatus): string {
  if (vcs.kind === "None") {
    return "None";
  }
  const warn = vcs.conflictCount > 0 ? " clash" : "";
  return `${vcs.kind} (${vcs.state}) down:${vcs.incomingCount} up:${vcs.outgoingCount} (${vcs.localChangesCount})${warn}`;
}

function formatVcsHtml(vcs: VcsStatus, isBusy = false, busyLabel = ""): string {
  if (vcs.kind === "None") {
    if (isBusy) {
      const safeBusy = busyLabel.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;");
      return `<div class="vcs-cell"><span class="vcs-kind">Git</span><span class="vcs-busy" title="${safeBusy || "Working..."}"><span class="vcs-busy-icon">${svgIcon("spinner")}</span></span></div>`;
    }
    return "";
  }
  const safeInfo = (vcs.infoMessage ?? "").replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;");
  const icon = vcs.kind === "Git"
    ? "Git"
    : vcs.kind === "Perforce"
      ? "Perforce"
      : vcs.kind === "SVN"
        ? "SVN"
        : vcs.kind === "Plastic"
          ? "Plastic"
          : vcs.kind === "Unity Version Control"
            ? "UnityVC"
            : "VC";
  const infoWarn = safeInfo
    ? `<span class="vcs-warn vcs-info-warn" title="${safeInfo}">${svgIcon("warning")}</span>`
    : "";
  const conflictWarn = vcs.conflictCount > 0
    ? `<span class="vcs-warn" title="Conflict/clash detected">${svgIcon("warning")}</span>`
    : "";
  const incoming = vcs.incomingCount > 0
    ? metricWithIcon("arrowDown", vcs.incomingCount, "Changes to pull", true)
    : "";
  const outgoing = vcs.kind === "Git"
    ? (vcs.outgoingCount > 0 ? metricWithIcon("arrowUp", vcs.outgoingCount, "Changes to push", true) : "")
    : "";
  const changed = vcs.localChangesCount > 0
    ? metricWithIcon("dot", `(${vcs.localChangesCount})`, "Changed files", false, true)
    : "";
  const safeBusy = busyLabel.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;");
  const busy = isBusy && vcs.kind === "Git"
    ? `<span class="vcs-busy" title="${safeBusy || "Running git command"}"><span class="vcs-busy-icon">${svgIcon("spinner")}</span></span>`
    : "";
  return `<div class="vcs-cell"><span class="vcs-kind">${icon}</span>${busy}${conflictWarn}${infoWarn}${changed}${outgoing}${incoming}</div>`;
}
function formatLastOpened(iso: string): string {
  if (!iso) {
    return "never";
  }
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function statusLabel(missing: boolean, isOpen: boolean, isInstalled: boolean, isCloud: boolean): string {
  if (missing) {
    return "<span class=\"warning-pill\">Missing</span>";
  }
  if (isOpen) {
    return "<span class=\"open-pill\">Open</span>";
  }
  if (isInstalled) {
    return "<span class=\"open-pill\">Installed</span>";
  }
  if (isCloud) {
    return "<span class=\"cloud-pill\">Cloud</span>";
  }
  return "";
}

function warningLabel(missing: boolean): string {
  return missing ? "<span class=\"warning-pill\">Missing</span>" : "";
}

function normalizeUnityVersion(value: string): string {
  return value.trim().toLowerCase();
}

function isUnityVersionAvailable(version: string): boolean {
  const normalized = normalizeUnityVersion(version);
  if (!normalized) {
    return true;
  }
  if (availableUnityVersions.has(normalized)) {
    return true;
  }
  for (const installed of availableUnityVersions) {
    if (installed.startsWith(normalized) || normalized.startsWith(installed)) {
      return true;
    }
  }
  return false;
}

function createCellContent(value: string, asHtml = false): HTMLDivElement {
  const content = document.createElement("div");
  content.className = "cell-content";
  if (asHtml) {
    content.innerHTML = value;
  } else {
    const text = document.createElement("span");
    text.className = "cell-text";
    text.textContent = value;
    content.appendChild(text);
  }
  return content;
}

function createMenuItem(
  label: string,
  icon: string,
  onClick: (event: MouseEvent) => void | Promise<void>,
  danger = false,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = danger ? "menu-item danger-item" : "menu-item";
  button.type = "button";
  const iconEl = document.createElement("span");
  iconEl.className = "menu-item-icon";
  iconEl.setAttribute("aria-hidden", "true");
  iconEl.textContent = icon;
  const textEl = document.createElement("span");
  textEl.textContent = label;
  button.appendChild(iconEl);
  button.appendChild(textEl);
  button.addEventListener("click", onClick);
  return button;
}

function compareValues(left: string | number | boolean, right: string | number | boolean): number {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}

function parseTimestamp(iso: string): number {
  if (!iso) {
    return 0;
  }
  const ts = Date.parse(iso);
  return Number.isFinite(ts) ? ts : 0;
}

function updateSortHeaderIndicators(tableId: "projects-table" | "installs-table", key: string, direction: SortDirection): void {
  const headers = document.querySelectorAll<HTMLTableCellElement>(`#${tableId} thead th.sortable`);
  headers.forEach((header) => {
    const label = header.dataset.label ?? header.textContent ?? "";
    const sortKey = header.dataset.sort ?? "";
    if (sortKey === key) {
      header.textContent = `${label} ${direction === "asc" ? "^" : "v"}`;
    } else {
      header.textContent = label;
    }
  });
}

function getDisplayName(project: ProjectEntry): string {
  const nickname = project.nickname.trim();
  if (nickname) {
    return nickname;
  }
  return project.name;
}

function getFilteredProjects(): ProjectEntry[] {
  const q = searchText.trim().toLowerCase();
  if (!q) {
    return projects;
  }
  return projects.filter((p) =>
    [getDisplayName(p), p.name, p.path, p.unityVersion, p.cloudRepo ?? "", p.cloneUrl ?? ""]
      .some((v) => v.toLowerCase().includes(q)),
  );
}

function closeAddMenu(): void {
  addMenu?.classList.add("hidden");
  addMenuInstalls?.classList.add("hidden");
}

function openDialog(dialogEl: HTMLDialogElement | null): void {
  if (!dialogEl) {
    return;
  }
  closeAddMenu();
  dialogEl.showModal();
}

function closeProjectRowMenus(): void {
  openProjectMenuId = "";
  document.querySelectorAll<HTMLElement>("#projects-table .row-menu").forEach((menu) => menu.classList.add("hidden"));
  document.querySelectorAll<HTMLElement>("#projects-table tbody tr.menu-open").forEach((row) => row.classList.remove("menu-open"));
}

function closeInstallRowMenus(): void {
  openInstallMenuPath = "";
  document.querySelectorAll<HTMLElement>("#installs-table .row-menu").forEach((menu) => menu.classList.add("hidden"));
  document.querySelectorAll<HTMLElement>("#installs-table tbody tr.menu-open").forEach((row) => row.classList.remove("menu-open"));
}

function setProjectBusy(projectId: string, operation: string, busy: boolean): void {
  if (busy) {
    busyProjectOps.set(projectId, operation);
  } else {
    busyProjectOps.delete(projectId);
  }
  void renderProjectsTable();
}

async function withProjectBusy<T>(projectId: string, operation: string, task: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  setProjectBusy(projectId, operation, true);
  try {
    return await task();
  } finally {
    const elapsed = Date.now() - startedAt;
    const minVisibleMs = 350;
    if (elapsed < minVisibleMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, minVisibleMs - elapsed));
    }
    setProjectBusy(projectId, "", false);
  }
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const max = Math.max(1, limit);
  let index = 0;
  async function runner(): Promise<void> {
    while (index < items.length) {
      const current = index;
      index += 1;
      await worker(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(max, items.length || 1) }, () => runner()));
}

function createProjectEntry(partial: Partial<ProjectEntry>): ProjectEntry {
  return {
    id: partial.id ?? "",
    nickname: partial.nickname ?? "",
    name: partial.name ?? "",
    path: partial.path ?? "",
    unityVersion: partial.unityVersion ?? "",
    unityExe: partial.unityExe ?? "",
    lastOpenedIso: partial.lastOpenedIso ?? "",
    autoGetLatest: partial.autoGetLatest ?? getAutoGetLatestDefault(),
    cloudRepo: partial.cloudRepo ?? "",
    cloneUrl: partial.cloneUrl ?? "",
    repoSizeBytes: partial.repoSizeBytes ?? 0,
  };
}

function requireValue(input: HTMLInputElement | null): string {
  return input?.value.trim() ?? "";
}

function getDefaultCloneDir(): string {
  const explicit = requireValue(settingsDefaultCloneDir);
  if (explicit) {
    return explicit;
  }
  return (localStorage.getItem(defaultCloneDirKey) ?? "").trim();
}

function getAutoGetLatestDefault(): boolean {
  if (settingsAutoGetLatestDefault) {
    return settingsAutoGetLatestDefault.checked;
  }
  return localStorage.getItem(autoGetLatestDefaultKey) === "true";
}

function shouldAutoGetLatest(project: ProjectEntry): boolean {
  if (typeof project.autoGetLatest === "boolean") {
    return project.autoGetLatest;
  }
  return getAutoGetLatestDefault();
}

function loadDismissedInstallPaths(): Set<string> {
  try {
    const raw = localStorage.getItem(dismissedInstallsKey);
    if (!raw) {
      return new Set<string>();
    }
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed)) {
      return new Set<string>();
    }
    return new Set(parsed.map((item) => item.toLowerCase()));
  } catch {
    return new Set<string>();
  }
}

function saveDismissedInstallPaths(value: Set<string>): void {
  localStorage.setItem(dismissedInstallsKey, JSON.stringify([...value]));
}

function dismissInstallPath(pathValue: string): void {
  const next = loadDismissedInstallPaths();
  next.add(pathValue.toLowerCase());
  saveDismissedInstallPaths(next);
}

function loadCustomInstallPaths(): string[] {
  try {
    const raw = localStorage.getItem(customInstallsKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item) => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

function saveCustomInstallPaths(paths: string[]): void {
  localStorage.setItem(customInstallsKey, JSON.stringify(paths));
}

function addCustomInstallPath(pathValue: string): void {
  const normalized = pathValue.trim().toLowerCase();
  if (!normalized) {
    return;
  }
  const existing = loadCustomInstallPaths();
  if (existing.some((item) => item.trim().toLowerCase() === normalized)) {
    return;
  }
  saveCustomInstallPaths([...existing, pathValue.trim()]);
}

function inferInstallVersionFromPath(exePath: string): string {
  const match = exePath.match(/(\d{4}\.\d+\.\d+[a-z]\d+|\d+\.\d+\.\d+[a-z]\d+)/i);
  return match?.[1] ?? "unknown";
}

function getFilteredInstalls(): UnityInstall[] {
  const q = searchInstallsText.trim().toLowerCase();
  if (!q) {
    return installs;
  }
  return installs.filter((install) =>
    [install.version, install.path, install.source].some((value) => value.toLowerCase().includes(q)),
  );
}

function dedupeProjects(input: ProjectEntry[]): ProjectEntry[] {
  const seen = new Set<string>();
  const result: ProjectEntry[] = [];
  for (const project of input) {
    const normalizedPath = project.path.trim().replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
    const normalizedCloudRepo = (project.cloudRepo ?? "").trim().toLowerCase();
    const normalizedCloneUrl = (project.cloneUrl ?? "").trim().toLowerCase();
    const key = normalizedPath
      ? `path:${normalizedPath}`
      : (normalizedCloudRepo ? `cloud:${normalizedCloudRepo}` : (normalizedCloneUrl ? `clone:${normalizedCloneUrl}` : `id:${project.id}`));
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(project);
  }
  return result;
}

async function launchProjectRow(project: ProjectEntry): Promise<void> {
  const result = await window.launcherApi.launchOrFocus(project);
  const transientLaunchMessage =
    /project already open|project appears open|focused existing unity window|attempting launch/i.test(result.message);
  const tone: StatusTone = /focus failed/i.test(result.message)
    ? "warning"
    : (result.ok ? "success" : "error");
  const autoResetMs = transientLaunchMessage ? 6000 : 0;
  await refreshProjects(false);
  setStatus(result.message, tone, autoResetMs);
}

function mergeProjects(local: ProjectEntry[], cloud: ProjectEntry[]): ProjectEntry[] {
  const localByCloudRepo = new Set(
    local
      .map((item) => (item.cloudRepo ?? "").trim().toLowerCase())
      .filter((value) => value.length > 0),
  );
  const filteredCloud = cloud.filter((item) => {
    const key = (item.cloudRepo ?? "").trim().toLowerCase();
    return key ? !localByCloudRepo.has(key) : true;
  });
  return dedupeProjects([...local, ...filteredCloud]);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = unitIndex === 0 ? value.toFixed(0) : value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2);
  return `${rounded} ${units[unitIndex]}`;
}

async function buildProjectTableRow(project: ProjectEntry): Promise<ProjectTableRow> {
  const hasLocalPath = project.path.trim().length > 0;
  const isCloud = Boolean((project.cloudRepo ?? "").trim() || (project.cloneUrl ?? "").trim());
  if (!hasLocalPath) {
    return {
      project,
      vcs: { kind: "None", branchOrStream: "", state: "not detected", localChangesCount: 0, incomingCount: 0, outgoingCount: 0, conflictCount: 0 },
      isMissing: false,
      isOpen: false,
      isCloud,
      isInstalled: false,
      remoteUrl: (project.cloneUrl ?? "").trim(),
      modifiedIso: project.lastOpenedIso || "",
      sizeBytes: Math.max(0, Number(project.repoSizeBytes ?? 0)),
      iconDataUrl: "",
    };
  }

  const [vcs, iconDataUrl, isOpen, remoteUrl, lastCommitIso, sizeBytes] = await Promise.all([
    window.launcherApi.getVcsStatus(project.path),
    window.launcherApi.getProjectIcon(project.path),
    window.launcherApi.isProjectOpen(project.path),
    window.launcherApi.getProjectRemoteUrl(project.path),
    window.launcherApi.getProjectLastCommitIso(project.path),
    window.launcherApi.getProjectSizeBytes(project.path),
  ]);
  return {
    project,
    vcs,
    isMissing: vcs.state === "missing path",
    isOpen,
    isCloud,
    isInstalled: vcs.state !== "missing path",
    remoteUrl,
    modifiedIso: lastCommitIso || project.lastOpenedIso || "",
    sizeBytes,
    iconDataUrl,
  };
}

async function syncProjectRowCache(force = false): Promise<void> {
  const validIds = new Set(projects.map((project) => project.id));
  for (const id of [...projectRowCache.keys()]) {
    if (!validIds.has(id)) {
      projectRowCache.delete(id);
    }
  }

  const toFetch: ProjectEntry[] = [];
  for (const project of projects) {
    const cached = projectRowCache.get(project.id);
    if (!force && cached) {
      cached.project = project;
      continue;
    }
    toFetch.push(project);
  }

  if (toFetch.length === 0) {
    return;
  }

  const rows = await withActivity("Updating project info...", async () => Promise.all(toFetch.map(buildProjectTableRow)));
  for (const row of rows) {
    projectRowCache.set(row.project.id, row);
  }
}

async function refreshProjectInfoForId(id: string, updateStatus = true, quick = false): Promise<void> {
  const project = projects.find((item) => item.id === id);
  if (!project) {
    if (updateStatus) {
      setStatus("Project not found", "warning", 4000);
    }
    return;
  }
  let effectiveProject = project;
  if (project.path.trim().length > 0) {
    const detectedVersion = await window.launcherApi.detectUnityVersion(project.path);
    if (detectedVersion && detectedVersion !== project.unityVersion) {
      const updatedProject: ProjectEntry = { ...project, unityVersion: detectedVersion };
      await saveProject(updatedProject);
      effectiveProject = projects.find((item) => item.id === id) ?? updatedProject;
    }
  }

  let row: ProjectTableRow;
  if (quick && effectiveProject.path.trim().length > 0) {
    const previousSize = projectRowCache.get(id)?.sizeBytes ?? 0;
    row = await withActivity("Updating project info...", async () => {
      const [vcs, iconDataUrl, isOpen, remoteUrl, lastCommitIso] = await Promise.all([
        window.launcherApi.getVcsStatus(effectiveProject.path),
        window.launcherApi.getProjectIcon(effectiveProject.path),
        window.launcherApi.isProjectOpen(effectiveProject.path),
        window.launcherApi.getProjectRemoteUrl(effectiveProject.path),
        window.launcherApi.getProjectLastCommitIso(effectiveProject.path),
      ]);
      return {
        project: effectiveProject,
        vcs,
        isMissing: vcs.state === "missing path",
        isOpen,
        isCloud: Boolean((effectiveProject.cloudRepo ?? "").trim() || (effectiveProject.cloneUrl ?? "").trim()),
        isInstalled: vcs.state !== "missing path",
        remoteUrl,
        modifiedIso: lastCommitIso || effectiveProject.lastOpenedIso || "",
        sizeBytes: previousSize,
        iconDataUrl,
      };
    });
  } else {
    row = await withActivity("Updating project info...", () => buildProjectTableRow(effectiveProject));
  }
  projectRowCache.set(project.id, row);
  await renderProjectsTable();
  if (updateStatus) {
    setStatus(`Updated ${getDisplayName(effectiveProject)}`, "success", 2500);
  }
}

function openProjectSettings(project: ProjectEntry): void {
  editingProjectId = project.id;
  if (projectSettingsNickname) {
    projectSettingsNickname.value = project.nickname;
  }
  if (projectSettingsAutoGetLatest) {
    projectSettingsAutoGetLatest.checked = shouldAutoGetLatest(project);
  }
  projectSettingsDialog?.showModal();
}

async function removeProjectById(id: string): Promise<void> {
  const localProjects = await window.launcherApi.deleteProject(id);
  if (selectedId === id) {
    selectedId = "";
  }
  if (editingProjectId === id) {
    editingProjectId = "";
    projectSettingsDialog?.close();
  }
  projects = mergeProjects(dedupeProjects(localProjects), cloudProjects);
  await renderProjectsTable();
  setStatus("Project removed");
}

async function renderProjectsTable(): Promise<void> {
  if (!tbody) {
    return;
  }

  await syncProjectRowCache(false);
  const token = ++projectsRenderToken;
  const visible = getFilteredProjects();
  const rows: ProjectTableRow[] = visible
    .map((project) => projectRowCache.get(project.id))
    .filter((row): row is ProjectTableRow => Boolean(row));

  if (token !== projectsRenderToken) {
    return;
  }

  rows.sort((a, b) => {
    let left: string | number | boolean;
    let right: string | number | boolean;

    switch (projectSort.key) {
      case "displayName":
        left = getDisplayName(a.project);
        right = getDisplayName(b.project);
        break;
      case "path":
        left = a.project.path;
        right = b.project.path;
        break;
      case "unityVersion":
        left = a.project.unityVersion;
        right = b.project.unityVersion;
        break;
      case "vcs":
        left = formatVcsText(a.vcs);
        right = formatVcsText(b.vcs);
        break;
      case "branchOrStream":
        left = a.vcs.branchOrStream || "-";
        right = b.vcs.branchOrStream || "-";
        break;
      case "lastOpenedIso":
        left = parseTimestamp(a.modifiedIso);
        right = parseTimestamp(b.modifiedIso);
        break;
      case "sizeBytes":
        left = a.sizeBytes;
        right = b.sizeBytes;
        break;
      case "status":
        left = a.isMissing ? 4 : a.isOpen ? 3 : a.isInstalled ? 2 : a.isCloud ? 1 : 0;
        right = b.isMissing ? 4 : b.isOpen ? 3 : b.isInstalled ? 2 : b.isCloud ? 1 : 0;
        break;
      default:
        left = 0;
        right = 0;
    }

    const cmp = compareValues(left, right);
    return projectSort.direction === "asc" ? cmp : -cmp;
  });

  updateSortHeaderIndicators("projects-table", projectSort.key, projectSort.direction);

  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const project = row.project;
    const tr = document.createElement("tr");
    tr.classList.add("clickable");
    tr.dataset.id = project.id;
    if (project.id === selectedId) {
      tr.classList.add("selected");
    }

    const busyOp = busyProjectOps.get(project.id) ?? "";
    const isBusy = busyOp.length > 0;
    if (isBusy) {
      tr.classList.add("row-busy");
    }

    const vcs = row.vcs;
    const isMissing = row.isMissing;
    const isOpen = row.isOpen;
    const isCloud = row.isCloud;
    const isInstalled = row.isInstalled;
    const remoteUrl = row.remoteUrl.trim();
    if (isCloud && !project.path.trim()) {
      tr.classList.add("cloud-row");
    }

    const values: Array<string> = [
      project.path || project.cloneUrl || project.cloudRepo || "",
      project.unityVersion,
      formatLastOpened(row.modifiedIso),
      formatBytes(row.sizeBytes),
      statusLabel(isMissing, isOpen, isInstalled, isCloud),
    ];

    const projectCell = document.createElement("td");
    const projectContent = document.createElement("div");
    projectContent.className = "cell-content cell-with-icon";
    const icon = document.createElement("img");
    icon.className = "project-icon";
    icon.alt = "";
    icon.src = isCloud && !project.path.trim()
      ? "./assets/cloud.svg"
      : (row.iconDataUrl || "./assets/unityhub.png");
    const label = document.createElement("span");
    label.className = "cell-text";
    label.textContent = getDisplayName(project);
    projectContent.appendChild(icon);
    projectContent.appendChild(label);
    projectCell.appendChild(projectContent);
    tr.appendChild(projectCell);

    const pathTd = document.createElement("td");
    pathTd.appendChild(createCellContent(values[0]));
    tr.appendChild(pathTd);

    const versionTd = document.createElement("td");
    const versionContent = createCellContent(values[1]);
    const showEditorWarning = project.path.trim().length > 0 && !isMissing && !isUnityVersionAvailable(project.unityVersion);
    if (showEditorWarning) {
      const warn = document.createElement("span");
      warn.className = "editor-missing-warn";
      warn.title = `No matching Unity editor install found for ${project.unityVersion || "this project"}`;
      warn.innerHTML = svgIcon("warning");
      versionContent.appendChild(warn);
    }
    versionTd.appendChild(versionContent);
    tr.appendChild(versionTd);

    const vcsTd = document.createElement("td");
    vcsTd.appendChild(createCellContent(formatVcsHtml(vcs, isBusy, busyOp), true));
    tr.appendChild(vcsTd);

    const lastOpenedTd = document.createElement("td");
    lastOpenedTd.appendChild(createCellContent(vcs.kind === "None" ? "" : (vcs.branchOrStream || "-")));
    tr.appendChild(lastOpenedTd);

    const modifiedTd = document.createElement("td");
    modifiedTd.appendChild(createCellContent(values[2]));
    tr.appendChild(modifiedTd);

    const sizeTd = document.createElement("td");
    sizeTd.appendChild(createCellContent(values[3]));
    tr.appendChild(sizeTd);

    const statusTd = document.createElement("td");
    statusTd.appendChild(createCellContent(values[4], true));
    tr.appendChild(statusTd);

    const actionsTd = document.createElement("td");
    actionsTd.className = "actions-cell";
    const actionsWrap = document.createElement("div");
    actionsWrap.className = "row-actions";
    const actionsButton = document.createElement("button");
    actionsButton.className = "icon-btn row-action-btn";
    actionsButton.type = "button";
    actionsButton.textContent = "...";
    actionsButton.setAttribute("aria-label", "Project actions");
    const rowMenu = document.createElement("div");
    rowMenu.className = `menu row-menu${openProjectMenuId === project.id ? "" : " hidden"}`;
    rowMenu.addEventListener("click", (event) => event.stopPropagation());
    actionsButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (isBusy) {
        setStatus("Please wait for git operation to finish.", "info", 2500);
        return;
      }
      const shouldOpen = openProjectMenuId !== project.id;
      closeProjectRowMenus();
      if (shouldOpen) {
        openProjectMenuId = project.id;
        tr.classList.add("menu-open");
        rowMenu.classList.remove("hidden");
      }
    });
    actionsWrap.appendChild(actionsButton);

    const settingsBtn = createMenuItem("Settings", "⚙", (event) => {
      event.stopPropagation();
      closeProjectRowMenus();
      openProjectSettings(project);
      void renderProjectsTable();
    });

    const browseBtn = createMenuItem("Browse to", "📁", async (event) => {
      event.stopPropagation();
      closeProjectRowMenus();
      const result = await window.launcherApi.browseTo(project.path);
      setStatus(result.message, "success", 4000);
      void renderProjectsTable();
    });

    const refreshBtn = createMenuItem("Refresh", "↻", async (event) => {
      event.stopPropagation();
      closeProjectRowMenus();
      await withProjectBusy(project.id, "Refreshing project info...", async () => {
        await refreshProjectInfoForId(project.id);
      });
    });

    const commitPushBtn = createMenuItem("Commit & Push", "⬆", async (event) => {
      event.stopPropagation();
      closeProjectRowMenus();
      await withProjectBusy(project.id, "Committing & pushing...", async () => {
        const result = await withActivity("Committing and pushing...", () => window.launcherApi.gitCommitPush(project.path));
        await refreshProjectInfoForId(project.id, false, true);
        setActionStatus(result, 6000, 10000);
        if (!result.ok && result.conflict) {
          window.alert("Commit & Push found merge conflicts while syncing latest changes. Resolve conflicts in your git client, then push again.");
        }
      });
    });

    const pullBtn = createMenuItem("Pull", "⬇", async (event) => {
      event.stopPropagation();
      closeProjectRowMenus();
      await withProjectBusy(project.id, "Pulling latest changes...", async () => {
        const result = await withActivity("Pulling latest changes...", () => window.launcherApi.gitPull(project.path));
        await refreshProjectInfoForId(project.id, false, true);
        setActionStatus(result, 6000, 10000);
      });
    });

    const remoteBtn = createMenuItem("Open Remote", "🌐", async (event) => {
      event.stopPropagation();
      closeProjectRowMenus();
      if (!remoteUrl) {
        setStatus("Remote URL is missing.", "warning", 5000);
        return;
      }
      const result = await window.launcherApi.openExternalUrl(remoteUrl);
      setActionStatus(result, 4000, 7000);
    });

    const cloneBtn = createMenuItem("Clone", "⭳", async (event) => {
      event.stopPropagation();
      closeProjectRowMenus();
      const configuredDefault = getDefaultCloneDir();
      const suggestedFolder = (project.name || project.nickname || "project").trim() || "project";
      const targetDir = await window.launcherApi.pickCloneTarget(configuredDefault, suggestedFolder);
      if (!targetDir) {
        setStatus("Clone cancelled");
        return;
      }
      await withProjectBusy(project.id, "Cloning...", async () => {
        const result = await withActivity(
          `Cloning ${getDisplayName(project)}...`,
          () => window.launcherApi.cloneCloudProject(project.id, targetDir),
        );
        if (result.ok) {
          cloudProjects = await window.launcherApi.getCloudProjects();
          projects = mergeProjects(dedupeProjects(result.projects), dedupeProjects(cloudProjects));
          await syncProjectRowCache(true);
          await renderProjectsTable();
          setStatus("Cloud project cloned and installed.", "success", 6000);
          return;
        }
        await refreshProjectInfoForId(project.id, false, true);
        setActionStatus(result, 5000, 10000);
      });
    });

    const removeBtn = createMenuItem("Remove", "🗑", async (event) => {
      event.stopPropagation();
      closeProjectRowMenus();
      if (!project.path.trim()) {
        cloudProjects = await window.launcherApi.deleteCloudProject(project.id);
        projects = mergeProjects(projects.filter((item) => item.path.trim().length > 0), cloudProjects);
        await renderProjectsTable();
        setStatus("Cloud project removed");
        return;
      }
      await removeProjectById(project.id);
    }, true);

    if (project.path.trim()) {
      rowMenu.appendChild(settingsBtn);
      rowMenu.appendChild(browseBtn);
      rowMenu.appendChild(refreshBtn);
      if (vcs.kind === "Git") {
        rowMenu.appendChild(commitPushBtn);
        rowMenu.appendChild(pullBtn);
      }
      if (remoteUrl) {
        rowMenu.appendChild(remoteBtn);
      }
    } else {
      rowMenu.appendChild(cloneBtn);
      if (remoteUrl) {
        rowMenu.appendChild(remoteBtn);
      }
    }
    rowMenu.appendChild(removeBtn);
    actionsWrap.appendChild(rowMenu);
    actionsTd.appendChild(actionsWrap);
    tr.appendChild(actionsTd);

    tr.addEventListener("click", async () => {
      if (isBusy) {
        setStatus("Project is busy with source control operation.", "info", 3000);
        return;
      }
      selectedId = project.id;
      if (isMissing) {
        setStatus("Project path is missing");
        return;
      }
      if (!project.path.trim()) {
        setStatus("Project is only in cloud. Use Actions > Clone first.", "info", 6000);
        return;
      }
      await launchProjectRow(project);
    });

    tr.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (isBusy) {
        setStatus("Project is busy with source control operation.", "info", 3000);
        return;
      }
      selectedId = project.id;
      openInstallMenuPath = "";
      const shouldOpen = openProjectMenuId !== project.id;
      closeProjectRowMenus();
      if (shouldOpen) {
        openProjectMenuId = project.id;
        tr.classList.add("menu-open");
        rowMenu.classList.remove("hidden");
      }
    });

    fragment.appendChild(tr);
  }

  tbody.innerHTML = "";
  tbody.appendChild(fragment);
}

function renderInstallsTable(): void {
  if (!installsTbody) {
    return;
  }

  installsTbody.innerHTML = "";
  const sortedInstalls = [...getFilteredInstalls()].sort((a, b) => {
    let left: string | number | boolean;
    let right: string | number | boolean;

    switch (installSort.key) {
      case "version":
        left = a.version;
        right = b.version;
        break;
      case "path":
        left = a.path;
        right = b.path;
        break;
      case "source":
        left = a.source;
        right = b.source;
        break;
      case "status":
        left = !a.exists;
        right = !b.exists;
        break;
      default:
        left = 0;
        right = 0;
    }

    const cmp = compareValues(left, right);
    return installSort.direction === "asc" ? cmp : -cmp;
  });

  updateSortHeaderIndicators("installs-table", installSort.key, installSort.direction);

  for (const install of sortedInstalls) {
    const tr = document.createElement("tr");
    tr.classList.add("clickable");

    const values: Array<string> = [
      install.path,
      install.source,
      warningLabel(!install.exists),
    ];

    const versionTd = document.createElement("td");
    const versionContent = document.createElement("div");
    versionContent.className = "cell-content cell-with-icon";
    const versionIcon = document.createElement("img");
    versionIcon.className = "project-icon";
    versionIcon.alt = "";
    versionIcon.src = "./assets/unityhub.png";
    const versionText = document.createElement("span");
    versionText.className = "cell-text";
    versionText.textContent = install.version;
    versionContent.appendChild(versionIcon);
    versionContent.appendChild(versionText);
    versionTd.appendChild(versionContent);
    tr.appendChild(versionTd);

    for (let i = 0; i < values.length; i += 1) {
      const td = document.createElement("td");
      td.appendChild(createCellContent(values[i], i === values.length - 1));
      tr.appendChild(td);
    }

    const actionsTd = document.createElement("td");
    actionsTd.className = "actions-cell";
    const actionsWrap = document.createElement("div");
    actionsWrap.className = "row-actions install-row-actions";

    const actionsButton = document.createElement("button");
    actionsButton.className = "icon-btn row-action-btn";
    actionsButton.type = "button";
    actionsButton.textContent = "...";
    actionsButton.setAttribute("aria-label", "Install actions");
    const rowMenu = document.createElement("div");
    rowMenu.className = `menu row-menu${openInstallMenuPath === install.path ? "" : " hidden"}`;
    rowMenu.addEventListener("click", (event) => event.stopPropagation());
    actionsButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const shouldOpen = openInstallMenuPath !== install.path;
      closeInstallRowMenus();
      if (shouldOpen) {
        openInstallMenuPath = install.path;
        tr.classList.add("menu-open");
        rowMenu.classList.remove("hidden");
      }
    });
    actionsWrap.appendChild(actionsButton);

    const removeBtn = createMenuItem("Remove", "🗑", (event) => {
      event.stopPropagation();
      dismissInstallPath(install.path);
      openInstallMenuPath = "";
      installs = installs.filter((item) => item.path.toLowerCase() !== install.path.toLowerCase());
      renderInstallsTable();
      setStatus("Install removed");
    }, true);

    const browseBtn = createMenuItem("Browse to", "📁", async (event) => {
      event.stopPropagation();
      closeInstallRowMenus();
      const result = await window.launcherApi.browseTo(install.path);
      setStatus(result.message, "success", 4000);
      renderInstallsTable();
    });

    rowMenu.appendChild(browseBtn);
    rowMenu.appendChild(removeBtn);
    actionsWrap.appendChild(rowMenu);
    actionsTd.appendChild(actionsWrap);
    tr.appendChild(actionsTd);

    tr.addEventListener("click", async () => {
      if (!install.exists) {
        setStatus("Unity install path is missing");
        return;
      }
      const result = await window.launcherApi.launchUnityEditor(install.path);
      setStatus(result.message, "success", 4000);
    });

    tr.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openProjectMenuId = "";
      const shouldOpen = openInstallMenuPath !== install.path;
      closeInstallRowMenus();
      if (shouldOpen) {
        openInstallMenuPath = install.path;
        tr.classList.add("menu-open");
        rowMenu.classList.remove("hidden");
      }
    });

    installsTbody.appendChild(tr);
  }
}

async function refreshProjects(updateStatus = true): Promise<void> {
  let localProjects = await window.launcherApi.getProjects();
  if (updateStatus) {
    let changedCount = 0;
    const scannedProjects = await withActivity("Refreshing Unity versions...", async () => {
      const updated = [...localProjects];
      for (let i = 0; i < updated.length; i += 1) {
        const project = updated[i];
        if (!project.path.trim()) {
          continue;
        }
        const detectedVersion = await window.launcherApi.detectUnityVersion(project.path);
        if (detectedVersion && detectedVersion !== project.unityVersion) {
          const nextProject = { ...project, unityVersion: detectedVersion };
          await window.launcherApi.saveProject(nextProject);
          updated[i] = nextProject;
          changedCount += 1;
        }
      }
      return updated;
    });
    localProjects = scannedProjects;
    if (changedCount > 0) {
      localProjects = await window.launcherApi.getProjects();
    }
  }

  const [remoteCloudProjects, detectedInstalls] = await Promise.all([
    window.launcherApi.getCloudProjects(),
    window.launcherApi.getUnityInstalls(),
  ]);
  const customInstallVersions = loadCustomInstallPaths().map(inferInstallVersionFromPath);
  availableUnityVersions = new Set([
    ...detectedInstalls.map((item) => normalizeUnityVersion(item.version)),
    ...customInstallVersions.map((item) => normalizeUnityVersion(item)),
  ].filter((value) => value.length > 0));
  cloudProjects = dedupeProjects(remoteCloudProjects);
  projects = mergeProjects(dedupeProjects(localProjects), cloudProjects);
  await renderProjectsTable();
  if (updateStatus) {
    setStatus(`Loaded ${projects.length} projects`);
  }
}

async function autoGetLatestOnStartup(): Promise<void> {
  const targets = projects.filter((project) => project.path.trim().length > 0 && shouldAutoGetLatest(project));
  if (targets.length === 0) {
    return;
  }

  let updated = 0;
  let upToDate = 0;
  let skipped = 0;
  let failed = 0;

  await withActivity("Getting latest project changes...", async () => {
    await runWithConcurrency(targets, 2, async (project) => {
      await withProjectBusy(project.id, "Auto get latest...", async () => {
        const vcs = await window.launcherApi.getVcsStatus(project.path);
        if (vcs.kind !== "Git") {
          skipped += 1;
          return;
        }
        const result = await window.launcherApi.gitPull(project.path);
        if (result.ok) {
          if (/already up to date/i.test(result.message)) {
            upToDate += 1;
          } else {
            updated += 1;
          }
        } else {
          failed += 1;
        }
      });
    });
  });

  await syncProjectRowCache(true);
  await renderProjectsTable();
  const msg = `Auto latest: ${updated} updated, ${upToDate} up to date${skipped ? `, ${skipped} skipped` : ""}${failed ? `, ${failed} failed` : ""}`;
  setStatus(msg, failed > 0 ? "warning" : "info", 7000);
}

async function refreshInstalls(updateStatus = true): Promise<void> {
  installs = await withActivity("Scanning Unity installs...", async () => {
    const dismissed = loadDismissedInstallPaths();
    const detectedInstalls = await window.launcherApi.getUnityInstalls();
    const customInstalls: UnityInstall[] = loadCustomInstallPaths().map((installPath) => ({
      version: inferInstallVersionFromPath(installPath),
      path: installPath,
      source: "Manual",
      exists: true,
    }));

    const merged = [...detectedInstalls, ...customInstalls];
    const deduped = new Map<string, UnityInstall>();
    for (const install of merged) {
      const key = install.path.toLowerCase();
      if (!deduped.has(key)) {
        deduped.set(key, install);
      }
    }
    return [...deduped.values()].filter((install) => !dismissed.has(install.path.toLowerCase()));
  });
  renderInstallsTable();
  if (updateStatus) {
    setStatus("Unity installs refreshed");
  }
}

async function saveProject(project: ProjectEntry): Promise<void> {
  const existing = project.id ? projects.find((x) => x.id === project.id) : undefined;
  if (existing && !project.lastOpenedIso) {
    project.lastOpenedIso = existing.lastOpenedIso;
  }
  const localProjects = await window.launcherApi.saveProject(project);
  projects = mergeProjects(dedupeProjects(localProjects), cloudProjects);
  await renderProjectsTable();
}

async function addFromDisk(): Promise<void> {
  const projectPath = requireValue(diskPath);
  if (!projectPath) {
    setStatus("Project folder is required");
    return;
  }

  const version = await window.launcherApi.detectUnityVersion(projectPath);
  const inferredName = projectPath.split(/[\\/]/).filter(Boolean).pop() ?? "Project";

  const project = createProjectEntry({
    path: projectPath,
    name: inferredName,
    nickname: requireValue(diskNickname),
    unityVersion: version,
    unityExe: requireValue(diskUnityExe) || requireValue(settingsDefaultUnityExe),
  });

  await saveProject(project);
  diskDialog?.close();
  if (diskPath) diskPath.value = "";
  if (diskNickname) diskNickname.value = "";
  if (diskUnityExe) diskUnityExe.value = "";
  setStatus("Added project from disk");
}

async function addFromRepo(): Promise<void> {
  const url = requireValue(repoUrl);
  const target = requireValue(repoTarget);
  const branch = requireValue(repoBranch);

  if (!url || !target) {
    setStatus("Repository URL and target folder are required");
    return;
  }

  const clone = await withActivity("Cloning repository...", () => window.launcherApi.cloneRepo(url, target, branch));
  if (!clone.ok) {
    setActionStatus(clone, 5000, 10000);
    return;
  }

  const version = await window.launcherApi.detectUnityVersion(target);
  const inferredName = target.split(/[\\/]/).filter(Boolean).pop() ?? "Project";

  const project = createProjectEntry({
    path: target,
    name: inferredName,
    nickname: requireValue(repoNickname),
    unityVersion: version,
    unityExe: requireValue(repoUnityExe) || requireValue(settingsDefaultUnityExe),
  });

  await saveProject(project);
  repoDialog?.close();
  if (repoUrl) repoUrl.value = "";
  if (repoBranch) repoBranch.value = "";
  if (repoTarget) repoTarget.value = "";
  if (repoNickname) repoNickname.value = "";
  if (repoUnityExe) repoUnityExe.value = "";
  setStatus("Repository cloned and project added");
}

async function removeSelectedProject(): Promise<void> {
  if (!selectedId) {
    setStatus("Select a project by clicking a row first");
    return;
  }
  await removeProjectById(selectedId);
}

function wireSidebarTabs(): void {
  tabProjects?.addEventListener("click", () => activateTab("projects"));
  tabInstalls?.addEventListener("click", async () => {
    activateTab("installs");
    await refreshInstalls(false);
  });
  tabSettings?.addEventListener("click", () => {
    activateTab("settings");
    document.dispatchEvent(new CustomEvent("settings:refresh-dependencies"));
  });
}

function wireSorting(): void {
  const projectHeaders = document.querySelectorAll<HTMLTableCellElement>("#projects-table thead th.sortable");
  projectHeaders.forEach((header) => {
    header.addEventListener("click", () => {
      const key = header.dataset.sort as ProjectSortKey | undefined;
      if (!key) {
        return;
      }
      if (projectSort.key === key) {
        projectSort.direction = projectSort.direction === "asc" ? "desc" : "asc";
      } else {
        projectSort = { key, direction: key === "lastOpenedIso" ? "desc" : "asc" };
      }
      void renderProjectsTable();
    });
  });

  const installHeaders = document.querySelectorAll<HTMLTableCellElement>("#installs-table thead th.sortable");
  installHeaders.forEach((header) => {
    header.addEventListener("click", () => {
      const key = header.dataset.sort as InstallSortKey | undefined;
      if (!key) {
        return;
      }
      if (installSort.key === key) {
        installSort.direction = installSort.direction === "asc" ? "desc" : "asc";
      } else {
        installSort = { key, direction: "asc" };
      }
      renderInstallsTable();
    });
  });
}

function wireGlobalEvents(): void {
  const windowBar = document.querySelector<HTMLElement>(".window-bar");

  addToggle?.addEventListener("click", () => {
    addMenu?.classList.toggle("hidden");
    addMenuInstalls?.classList.add("hidden");
  });

  addToggleInstalls?.addEventListener("click", () => {
    addMenuInstalls?.classList.toggle("hidden");
    addMenu?.classList.add("hidden");
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (!target.closest(".add-wrap")) {
      closeAddMenu();
    }
    if (!target.closest(".row-actions")) {
      closeProjectRowMenus();
      closeInstallRowMenus();
    }
  });

  windowBar?.addEventListener("mousedown", () => {
    closeAddMenu();
    closeProjectRowMenus();
    closeInstallRowMenus();
  });

  searchInput?.addEventListener("input", () => {
    searchText = searchInput.value;
    void renderProjectsTable();
  });
  searchInstallsInput?.addEventListener("input", () => {
    searchInstallsText = searchInstallsInput.value;
    renderInstallsTable();
  });

  document.getElementById("refresh-btn")?.addEventListener("click", () => void refreshProjects());
  document.getElementById("refresh-installs")?.addEventListener("click", () => void refreshInstalls());
  document.getElementById("add-install-disk")?.addEventListener("click", async () => {
    const file = await window.launcherApi.pickFile();
    if (!file) {
      return;
    }
    addCustomInstallPath(file);
    closeAddMenu();
    await refreshInstalls(false);
    setStatus("Install added");
  });

  document.getElementById("new-project")?.addEventListener("click", () => {
    openDialog(diskDialog);
    setStatus("New project: choose a local project folder");
  });

}

function wireDiskDialog(): void {
  document.getElementById("add-disk")?.addEventListener("click", () => openDialog(diskDialog));

  document.getElementById("disk-browse-path")?.addEventListener("click", async () => {
    const dir = await window.launcherApi.pickDirectory();
    if (dir && diskPath) {
      diskPath.value = dir;
    }
  });

  document.getElementById("disk-browse-exe")?.addEventListener("click", async () => {
    const file = await window.launcherApi.pickFile();
    if (file && diskUnityExe) {
      diskUnityExe.value = file;
    }
  });

  document.getElementById("disk-save")?.addEventListener("click", async (event) => {
    event.preventDefault();
    await addFromDisk();
  });
}

function wireRepoDialog(): void {
  document.getElementById("add-repo")?.addEventListener("click", () => {
    if (repoTarget && !repoTarget.value.trim()) {
      repoTarget.value = getDefaultCloneDir();
    }
    openDialog(repoDialog);
  });

  document.getElementById("repo-browse-target")?.addEventListener("click", async () => {
    const dir = await window.launcherApi.pickDirectory();
    if (dir && repoTarget) {
      repoTarget.value = dir;
    }
  });

  document.getElementById("repo-browse-exe")?.addEventListener("click", async () => {
    const file = await window.launcherApi.pickFile();
    if (file && repoUnityExe) {
      repoUnityExe.value = file;
    }
  });

  document.getElementById("repo-save")?.addEventListener("click", async (event) => {
    event.preventDefault();
    await addFromRepo();
  });
}

function wireSettingsView(): void {
  const savedExe = localStorage.getItem(defaultUnityExeKey);
  if (savedExe && settingsDefaultUnityExe) {
    settingsDefaultUnityExe.value = savedExe;
  }

  const savedTheme = (localStorage.getItem(themePreferenceKey) as ThemePreference | null) ?? "system";
  if (settingsTheme) {
    settingsTheme.value = savedTheme;
  }
  applyTheme(savedTheme);

  const savedCloneDir = localStorage.getItem(defaultCloneDirKey);
  if (savedCloneDir && settingsDefaultCloneDir) {
    settingsDefaultCloneDir.value = savedCloneDir;
  }
  if (settingsAutoGetLatestDefault) {
    settingsAutoGetLatestDefault.checked = localStorage.getItem(autoGetLatestDefaultKey) === "true";
  }

  void window.launcherApi.getSettings().then((settings) => {
    if (settingsDisableRenderThrottling) {
      settingsDisableRenderThrottling.checked = settings.disableRenderThrottling ?? true;
    }
  });

  document.getElementById("settings-browse-exe")?.addEventListener("click", async () => {
    const file = await window.launcherApi.pickFile();
    if (file && settingsDefaultUnityExe) {
      settingsDefaultUnityExe.value = file;
      void persistSettings(true);
    }
  });

  document.getElementById("settings-browse-clone-dir")?.addEventListener("click", async () => {
    const dir = await window.launcherApi.pickDirectory();
    if (dir && settingsDefaultCloneDir) {
      settingsDefaultCloneDir.value = dir;
      void persistSettings(true);
    }
  });

  const persistSettings = async (showStatus = false): Promise<void> => {
    localStorage.setItem(defaultUnityExeKey, requireValue(settingsDefaultUnityExe));
    localStorage.setItem(defaultCloneDirKey, requireValue(settingsDefaultCloneDir));
    localStorage.setItem(autoGetLatestDefaultKey, String(settingsAutoGetLatestDefault?.checked ?? false));
    const pref = (settingsTheme?.value as ThemePreference) || "system";
    localStorage.setItem(themePreferenceKey, pref);
    applyTheme(pref);
    const disableRenderThrottling = settingsDisableRenderThrottling?.checked ?? true;
    await window.launcherApi.setDisableRenderThrottling(disableRenderThrottling);
    if (showStatus) {
      setStatus("Settings auto-saved.", "success", 1800);
    }
  };

  const onAutoSaveChange = (): void => {
    void persistSettings(true);
  };

  settingsTheme?.addEventListener("change", onAutoSaveChange);
  settingsDisableRenderThrottling?.addEventListener("change", onAutoSaveChange);
  settingsAutoGetLatestDefault?.addEventListener("change", onAutoSaveChange);
  settingsDefaultUnityExe?.addEventListener("change", onAutoSaveChange);
  settingsDefaultCloneDir?.addEventListener("change", onAutoSaveChange);
  settingsDefaultUnityExe?.addEventListener("input", () => void persistSettings(false));
  settingsDefaultCloneDir?.addEventListener("input", () => void persistSettings(false));
  void persistSettings(false);

  document.getElementById("settings-remove-missing")?.addEventListener("click", async () => {
    const result = await window.launcherApi.removeMissingProjects();
    await refreshProjects(false);
    setStatus(`Removed ${result.removed} missing projects`);
  });

  document.getElementById("settings-sync-hub")?.addEventListener("click", async () => {
    const result = await withActivity("Syncing from Unity Hub...", () => window.launcherApi.syncFromUnityHub());
    await Promise.all([refreshProjects(false), refreshInstalls(false)]);
    setActionStatus(result, 5000, 7000);
  });

  const copyText = async (value: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  };

  const runGuideAction = async (
    guide: { command: string; url: string; message: string },
    statusPrefix: string,
  ): Promise<void> => {
    const copied = await copyText(guide.command);
    const openResult = await window.launcherApi.openExternalUrl(guide.url);
    if (!openResult.ok) {
      setStatus(`${statusPrefix}. ${guide.message}`, "warning", 9000);
      return;
    }
    const copiedMsg = copied ? " Command copied to clipboard." : ` Command: ${guide.command}`;
    setStatus(`${statusPrefix}.${copiedMsg} Opened help page.`, "info", 10000);
  };

  const runInstallAction = async (
    button: HTMLButtonElement | null,
    spinner: HTMLElement | null,
    message: string,
    action: () => Promise<void>,
  ): Promise<void> => {
    if (!button) {
      return;
    }
    const previousDisabled = button.disabled;
    button.disabled = true;
    spinner?.classList.remove("hidden");
    try {
      await withActivity(message, action);
    } finally {
      spinner?.classList.add("hidden");
      button.disabled = previousDisabled;
    }
  };

  const refreshDependencyStatus = async (): Promise<void> => {
    const [deps, auth, gitlabAuth] = await Promise.all([
      window.launcherApi.getDependencyStatus(),
      window.launcherApi.getGitHubAuthStatus(),
      window.launcherApi.getGitLabAuthStatus(),
    ]);

    if (settingsGhInstallBtn) {
      settingsGhInstallBtn.classList.toggle("hidden", deps.ghInstalled);
    }
    settingsGhMissingLine?.classList.toggle("hidden", deps.ghInstalled);
    settingsGhInstalledLine?.classList.toggle("hidden", !deps.ghInstalled);

    if (settingsGhAuthBtn) {
      settingsGhAuthBtn.disabled = !deps.ghInstalled;
    }
    if (settingsGithubRefreshBtn) {
      settingsGithubRefreshBtn.disabled = !deps.ghAuthenticated;
    }
    settingsGhAuthMissingLine?.classList.toggle("hidden", deps.ghAuthenticated || !deps.ghInstalled);
    settingsGhConnectedLine?.classList.toggle("hidden", !deps.ghAuthenticated);
    if (settingsGhConnectedText) {
      settingsGhConnectedText.textContent = `Connected as ${deps.ghLogin || auth.login || "unknown"} (gh).`;
    }

    if (settingsHubInstallBtn) {
      settingsHubInstallBtn.classList.toggle("hidden", deps.hubInstalled);
    }
    settingsHubMissingLine?.classList.toggle("hidden", deps.hubInstalled);
    settingsHubInstalledLine?.classList.toggle("hidden", !deps.hubInstalled);

    if (settingsGitInstallBtn) {
      settingsGitInstallBtn.classList.toggle("hidden", deps.gitInstalled);
    }
    settingsGitMissingLine?.classList.toggle("hidden", deps.gitInstalled);
    settingsGitInstalledLine?.classList.toggle("hidden", !deps.gitInstalled);

    if (settingsGlabInstallBtn) {
      settingsGlabInstallBtn.classList.toggle("hidden", deps.glabInstalled);
    }
    settingsGlabMissingLine?.classList.toggle("hidden", deps.glabInstalled);
    settingsGlabInstalledLine?.classList.toggle("hidden", !deps.glabInstalled);

    if (settingsGlabAuthBtn) {
      settingsGlabAuthBtn.disabled = !deps.glabInstalled;
      settingsGlabAuthBtn.classList.toggle("hidden", deps.glabAuthenticated);
    }
    if (settingsGitlabRefreshBtn) {
      settingsGitlabRefreshBtn.disabled = !deps.glabAuthenticated;
    }
    settingsGlabAuthMissingLine?.classList.toggle("hidden", deps.glabAuthenticated || !deps.glabInstalled);
    settingsGlabConnectedLine?.classList.toggle("hidden", !deps.glabAuthenticated);
    if (settingsGlabConnectedText) {
      settingsGlabConnectedText.textContent = `Connected as ${deps.glabLogin || gitlabAuth.login || "unknown"} (glab).`;
    }

  };

  document.addEventListener("settings:refresh-dependencies", () => {
    void refreshDependencyStatus();
  });
  window.addEventListener("focus", () => {
    if (viewSettings?.classList.contains("active")) {
      void refreshDependencyStatus();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && viewSettings?.classList.contains("active")) {
      void refreshDependencyStatus();
    }
  });

  void refreshDependencyStatus();

  settingsGhInstallBtn?.addEventListener("click", async () => {
    await runInstallAction(
      settingsGhInstallBtn,
      settingsGhInstallLoading,
      "Starting GitHub CLI install...",
      async () => {
        const guide = await window.launcherApi.getGhInstallGuide();
        await runGuideAction(guide, "GH CLI install instructions");
        await refreshDependencyStatus();
      },
    );
  });

  settingsGitInstallBtn?.addEventListener("click", async () => {
    await runInstallAction(
      settingsGitInstallBtn,
      settingsGitInstallLoading,
      "Starting Git install...",
      async () => {
        const guide = await window.launcherApi.getGitInstallGuide();
        await runGuideAction(guide, "Git install instructions");
        await refreshDependencyStatus();
      },
    );
  });

  settingsGhAuthBtn?.addEventListener("click", async () => {
    if (settingsGhAuthBtn.disabled) {
      return;
    }
    settingsGhAuthBtn.blur();
    window.blur();
    settingsGhAuthBtn.disabled = true;
    const result = await window.launcherApi.startGhAuth();
    if (!result.ok) {
      setStatus(result.message, "warning", 9000);
      settingsGhAuthBtn.disabled = false;
      return;
    }
    setStatus(
      "Started GH login in terminal. Choose GitHub.com + HTTPS + web login, copy the one-time code, open the shown URL, paste code, authorize, then return.",
      "info",
      15000,
    );
    await refreshDependencyStatus();
    setTimeout(() => {
      void refreshDependencyStatus();
    }, 3500);
  });

  settingsHubInstallBtn?.addEventListener("click", async () => {
    await runInstallAction(
      settingsHubInstallBtn,
      settingsHubInstallLoading,
      "Starting Unity Hub install...",
      async () => {
        const guide = await window.launcherApi.getHubInstallGuide();
        await runGuideAction(guide, "Unity Hub install instructions");
        await refreshDependencyStatus();
      },
    );
  });

  settingsGlabInstallBtn?.addEventListener("click", async () => {
    await runInstallAction(
      settingsGlabInstallBtn,
      settingsGlabInstallLoading,
      "Starting GitLab CLI install...",
      async () => {
        settingsGlabInstallBtn.blur();
        window.blur();
        const result = await window.launcherApi.startGlabInstall();
        setStatus(result.message, result.ok ? "info" : "warning", 10000);
        await refreshDependencyStatus();
      },
    );
  });

  settingsGlabAuthBtn?.addEventListener("click", async () => {
    if (settingsGlabAuthBtn.disabled) {
      return;
    }
    settingsGlabAuthBtn.blur();
    window.blur();
    settingsGlabAuthBtn.disabled = true;
    const result = await window.launcherApi.startGlabAuth();
    if (!result.ok) {
      setStatus(result.message, "warning", 9000);
      settingsGlabAuthBtn.disabled = false;
      return;
    }
    setStatus(
      "Started GitLab login in terminal. Select gitlab.com + web login in the prompt, complete browser auth, then return.",
      "info",
      15000,
    );
    await refreshDependencyStatus();
    setTimeout(() => {
      void refreshDependencyStatus();
    }, 3500);
  });

  document.getElementById("settings-github-refresh-cloud")?.addEventListener("click", async () => {
    const result = await withActivity("Fetching cloud projects...", () => window.launcherApi.discoverCloudProjects());
    setActionStatus(result, 5000, 10000);
    if (result.ok) {
      await refreshProjects(false);
      await refreshDependencyStatus();
    }
  });

  document.getElementById("settings-gitlab-refresh-cloud")?.addEventListener("click", async () => {
    const result = await withActivity("Fetching GitLab cloud projects...", () => window.launcherApi.discoverGitLabCloudProjects());
    setActionStatus(result, 5000, 10000);
    if (result.ok) {
      await refreshProjects(false);
      await refreshDependencyStatus();
    }
  });
}

function wireProjectSettingsDialog(): void {
  document.getElementById("project-settings-save")?.addEventListener("click", async () => {
    const id = editingProjectId;
    if (!id) {
      return;
    }
    const existing = projects.find((project) => project.id === id);
    if (!existing) {
      return;
    }

    const updated: ProjectEntry = {
      ...existing,
      nickname: requireValue(projectSettingsNickname),
      autoGetLatest: projectSettingsAutoGetLatest?.checked ?? shouldAutoGetLatest(existing),
    };
    await saveProject(updated);
    editingProjectId = "";
    projectSettingsDialog?.close();
    await renderProjectsTable();
    setStatus("Project settings saved");
  });
}

async function init(): Promise<void> {
  if (didInit) {
    return;
  }
  didInit = true;
  try {
    wireSidebarTabs();
    wireSorting();
    wireGlobalEvents();
    wireDiskDialog();
    wireRepoDialog();
    wireSettingsView();
    wireProjectSettingsDialog();
    activateTab("projects");
    projectSort = { key: "lastOpenedIso", direction: "desc" };
    await refreshProjects(false);
    void autoGetLatestOnStartup();
  } catch (error) {
    setStatus(`UI init error: ${String(error)}`);
  }
}

void init();





