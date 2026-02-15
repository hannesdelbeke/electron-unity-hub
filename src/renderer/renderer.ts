type ProjectEntry = {
  id: string;
  nickname: string;
  name: string;
  path: string;
  unityVersion: string;
  unityExe: string;
  lastOpenedIso: string;
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
const searchInput = document.getElementById("search") as HTMLInputElement | null;
const searchInstallsInput = document.getElementById("search-installs") as HTMLInputElement | null;
const addToggle = document.getElementById("add-toggle") as HTMLButtonElement | null;
const addMenu = document.getElementById("add-menu") as HTMLDivElement | null;
const addToggleInstalls = document.getElementById("add-toggle-installs") as HTMLButtonElement | null;
const addMenuInstalls = document.getElementById("add-menu-installs") as HTMLDivElement | null;

const diskDialog = document.getElementById("disk-dialog") as HTMLDialogElement | null;
const repoDialog = document.getElementById("repo-dialog") as HTMLDialogElement | null;
const projectSettingsDialog = document.getElementById("project-settings-dialog") as HTMLDialogElement | null;
const githubTokenDialog = document.getElementById("github-token-dialog") as HTMLDialogElement | null;

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
const settingsDisableRenderThrottling =
  document.getElementById("settings-disable-render-throttling") as HTMLInputElement | null;
const projectSettingsNickname = document.getElementById("project-settings-nickname") as HTMLInputElement | null;
const githubTokenInput = document.getElementById("github-token-input") as HTMLInputElement | null;
const settingsGithubStatus = document.getElementById("settings-github-status");
const settingsGhInstallBtn = document.getElementById("settings-gh-install") as HTMLButtonElement | null;
const settingsGhInstalledBtn = document.getElementById("settings-gh-installed") as HTMLButtonElement | null;
const settingsGhLabel = document.getElementById("settings-gh-label");

const tabProjects = document.getElementById("tab-projects");
const tabInstalls = document.getElementById("tab-installs");
const tabSettings = document.getElementById("tab-settings");

const viewProjects = document.getElementById("view-projects");
const viewInstalls = document.getElementById("view-installs");
const viewSettings = document.getElementById("view-settings");

let projects: ProjectEntry[] = [];
let cloudProjects: ProjectEntry[] = [];
let installs: UnityInstall[] = [];
let selectedId = "";
let searchText = "";
let searchInstallsText = "";
let openProjectMenuId = "";
let openInstallMenuPath = "";
let editingProjectId = "";
let didInit = false;
let projectsRenderToken = 0;
const projectRowCache = new Map<string, ProjectTableRow>();
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
const dismissedInstallsKey = "unityLauncher.dismissedInstalls";
const customInstallsKey = "unityLauncher.customInstalls";

type TabName = "projects" | "installs" | "settings";

function setStatus(msg: string, tone: StatusTone = "success", autoResetMs = 0): void {
  statusSetToken += 1;
  const tokenAtSet = statusSetToken;
  if (statusResetTimer) {
    clearTimeout(statusResetTimer);
    statusResetTimer = null;
  }
  if (statusEl) {
    statusEl.textContent = msg;
    statusEl.classList.remove("status-success", "status-warning", "status-error", "status-info", "status-loading");
    statusEl.classList.add(`status-${tone}`);
    if (autoResetMs > 0) {
      statusResetTimer = setTimeout(() => {
        if (!statusEl || tokenAtSet !== statusSetToken) {
          return;
        }
        statusEl.textContent = "Ready";
        statusEl.classList.remove("status-success", "status-warning", "status-error", "status-info", "status-loading");
        statusEl.classList.add("status-info");
        statusResetTimer = null;
      }, autoResetMs);
    }
  }
}

function setActionStatus(result: ActionResult, successAutoResetMs = 4000, errorAutoResetMs = 0): void {
  setStatus(result.message, result.ok ? "success" : "error", result.ok ? successAutoResetMs : errorAutoResetMs);
}

async function withActivity<T>(message: string, task: () => Promise<T>): Promise<T> {
  activeStatusActivities += 1;
  const previousText = statusEl?.textContent ?? "";
  const previousClassName = statusEl?.className ?? "";
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
    setStatus(message, "info");
    statusEl?.classList.add("status-loading");
  }, 300);

  try {
    return await task();
  } finally {
    clearTimeout(timer);
    if (!timerCompleted) {
      shown = false;
    }
    activeStatusActivities = Math.max(0, activeStatusActivities - 1);
    if (statusEl && shown && activeStatusActivities === 0 && statusEl.classList.contains("status-loading")) {
      statusEl.textContent = statusLoadingRestoreText;
      statusEl.className = statusLoadingRestoreClassName;
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

function svgIcon(name: "warning" | "arrowDown" | "arrowUp" | "dot" | "moreHorizontal"): string {
  switch (name) {
    case "warning":
      return "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 9v4m0 4h.01M10.29 3.86l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.71-3.14l-8-14a2 2 0 0 0-3.42 0z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>";
    case "arrowDown":
      return "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 5v14m0 0-5-5m5 5 5-5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>";
    case "arrowUp":
      return "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 19V5m0 0-5 5m5-5 5 5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>";
    default:
      return "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"2.5\" fill=\"currentColor\"/></svg>";
  }
}

function metricWithIcon(icon: "arrowDown" | "arrowUp" | "dot", value: string | number, title: string): string {
  return `<span class="vcs-metric" title="${title}"><span class="vcs-metric-icon">${svgIcon(icon)}</span><span>${value}</span></span>`;
}

function formatVcsText(vcs: VcsStatus): string {
  if (vcs.kind === "None") {
    return "None";
  }
  const warn = vcs.conflictCount > 0 ? " clash" : "";
  return `${vcs.kind} (${vcs.state}) down:${vcs.incomingCount} up:${vcs.outgoingCount} (${vcs.localChangesCount})${warn}`;
}

function formatVcsHtml(vcs: VcsStatus): string {
  if (vcs.kind === "None") {
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
  const incoming = metricWithIcon("arrowDown", vcs.incomingCount, "Changes to pull");
  const outgoing = vcs.kind === "Git"
    ? metricWithIcon("arrowUp", vcs.outgoingCount, "Changes to push")
    : "";
  const changed = metricWithIcon("dot", `(${vcs.localChangesCount})`, "Changed files");
  return `<div class="vcs-cell"><span class="vcs-kind">${icon}</span>${conflictWarn}${infoWarn}${incoming}${outgoing}${changed}</div>`;
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

function createProjectEntry(partial: Partial<ProjectEntry>): ProjectEntry {
  return {
    id: partial.id ?? "",
    nickname: partial.nickname ?? "",
    name: partial.name ?? "",
    path: partial.path ?? "",
    unityVersion: partial.unityVersion ?? "",
    unityExe: partial.unityExe ?? "",
    lastOpenedIso: partial.lastOpenedIso ?? "",
    cloudRepo: partial.cloudRepo ?? "",
    cloneUrl: partial.cloneUrl ?? "",
    repoSizeBytes: partial.repoSizeBytes ?? 0,
  };
}

function requireValue(input: HTMLInputElement | null): string {
  return input?.value.trim() ?? "";
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

async function refreshProjectInfoForId(id: string, updateStatus = true): Promise<void> {
  const project = projects.find((item) => item.id === id);
  if (!project) {
    if (updateStatus) {
      setStatus("Project not found", "warning", 4000);
    }
    return;
  }
  const row = await withActivity("Updating project info...", () => buildProjectTableRow(project));
  projectRowCache.set(project.id, row);
  await renderProjectsTable();
  if (updateStatus) {
    setStatus(`Updated ${getDisplayName(project)}`, "success", 2500);
  }
}

function openProjectSettings(project: ProjectEntry): void {
  editingProjectId = project.id;
  if (projectSettingsNickname) {
    projectSettingsNickname.value = project.nickname;
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
    versionTd.appendChild(createCellContent(values[1]));
    tr.appendChild(versionTd);

    const vcsTd = document.createElement("td");
    vcsTd.appendChild(createCellContent(formatVcsHtml(vcs), true));
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
      await refreshProjectInfoForId(project.id);
    });

    const commitPushBtn = createMenuItem("Commit & Push", "⬆", async (event) => {
      event.stopPropagation();
      closeProjectRowMenus();
      const result = await withActivity("Committing and pushing...", () => window.launcherApi.gitCommitPush(project.path));
      setActionStatus(result, 6000, 0);
      if (!result.ok && result.conflict) {
        window.alert("Commit & Push found merge conflicts while syncing latest changes. Resolve conflicts in your git client, then push again.");
      }
      await refreshProjectInfoForId(project.id, false);
    });

    const pullBtn = createMenuItem("Pull", "⬇", async (event) => {
      event.stopPropagation();
      closeProjectRowMenus();
      const result = await withActivity("Pulling latest changes...", () => window.launcherApi.gitPull(project.path));
      setActionStatus(result, 6000, 0);
      await refreshProjectInfoForId(project.id, false);
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
      const parentDir = await window.launcherApi.pickDirectory();
      if (!parentDir) {
        setStatus("Clone cancelled");
        return;
      }
      const result = await withActivity("Cloning cloud project...", () => window.launcherApi.cloneCloudProject(project.id, parentDir));
      setActionStatus(result, 5000, 0);
      await refreshProjects(false);
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
  const [localProjects, remoteCloudProjects] = await Promise.all([
    window.launcherApi.getProjects(),
    window.launcherApi.getCloudProjects(),
  ]);
  cloudProjects = dedupeProjects(remoteCloudProjects);
  projects = mergeProjects(dedupeProjects(localProjects), cloudProjects);
  await renderProjectsTable();
  if (updateStatus) {
    setStatus(`Loaded ${projects.length} projects`);
  }
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
    setActionStatus(clone, 5000, 0);
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
  tabSettings?.addEventListener("click", () => activateTab("settings"));
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
  document.getElementById("add-repo")?.addEventListener("click", () => openDialog(repoDialog));

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

  void window.launcherApi.getSettings().then((settings) => {
    if (settingsDisableRenderThrottling) {
      settingsDisableRenderThrottling.checked = settings.disableRenderThrottling ?? true;
    }
  });

  document.getElementById("settings-browse-exe")?.addEventListener("click", async () => {
    const file = await window.launcherApi.pickFile();
    if (file && settingsDefaultUnityExe) {
      settingsDefaultUnityExe.value = file;
    }
  });

  document.getElementById("settings-save")?.addEventListener("click", () => {
    localStorage.setItem(defaultUnityExeKey, requireValue(settingsDefaultUnityExe));
    const pref = (settingsTheme?.value as ThemePreference) || "system";
    localStorage.setItem(themePreferenceKey, pref);
    applyTheme(pref);
    const disableRenderThrottling = settingsDisableRenderThrottling?.checked ?? true;
    void window.launcherApi.setDisableRenderThrottling(disableRenderThrottling);
    setStatus("Settings saved. Restart app to apply render throttling change.");
  });

  document.getElementById("settings-remove-missing")?.addEventListener("click", async () => {
    const result = await window.launcherApi.removeMissingProjects();
    await refreshProjects(false);
    setStatus(`Removed ${result.removed} missing projects`);
  });

  const refreshGitHubStatus = async (): Promise<void> => {
    const [status, gh] = await Promise.all([
      window.launcherApi.getGitHubAuthStatus(),
      window.launcherApi.getGhStatus(),
    ]);
    if (settingsGithubStatus) {
      if (status.connected) {
        const source = status.source === "gh" ? "gh" : "token";
        settingsGithubStatus.textContent = `Connected as ${status.login} (${source})`;
      } else {
        settingsGithubStatus.textContent = "GitHub not connected.";
      }
    }
    if (settingsGhLabel) {
      settingsGhLabel.textContent = gh.installed
        ? (gh.authenticated ? `Installed, authenticated as ${gh.login}.` : "Installed. Run `gh auth login` or use token below.")
        : gh.installHint;
    }
    if (settingsGhInstallBtn) {
      settingsGhInstallBtn.style.display = gh.installed ? "none" : "";
      settingsGhInstallBtn.disabled = gh.installed;
    }
    if (settingsGhInstalledBtn) {
      settingsGhInstalledBtn.style.display = gh.installed ? "" : "none";
      settingsGhInstalledBtn.disabled = !gh.installed;
    }
  };

  void refreshGitHubStatus();

  settingsGhInstallBtn?.addEventListener("click", async () => {
    const result = await window.launcherApi.openGhInstall();
    setStatus(`Opened GH CLI install page. ${result.message}`, "info", 7000);
    await refreshGitHubStatus();
  });

  document.getElementById("settings-github-connect")?.addEventListener("click", () => {
    githubTokenDialog?.showModal();
  });

  document.getElementById("github-token-save")?.addEventListener("click", async () => {
    const token = requireValue(githubTokenInput);
    if (!token) {
      setStatus("GitHub token is required", "warning");
      return;
    }
    const result = await withActivity("Connecting GitHub...", () => window.launcherApi.setGitHubToken(token));
    if (result.ok && githubTokenInput) {
      githubTokenInput.value = "";
      githubTokenDialog?.close();
    }
    setActionStatus(result, 5000, 0);
    await refreshGitHubStatus();
  });

  document.getElementById("settings-github-disconnect")?.addEventListener("click", async () => {
    await window.launcherApi.clearGitHubToken();
    await refreshGitHubStatus();
    setStatus("GitHub disconnected", "success", 4000);
  });

  document.getElementById("settings-github-refresh-cloud")?.addEventListener("click", async () => {
    const result = await withActivity("Fetching cloud projects...", () => window.launcherApi.discoverCloudProjects());
    setActionStatus(result, 5000, 0);
    if (result.ok) {
      await refreshProjects(false);
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
    };
    projects = await window.launcherApi.saveProject(updated);
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
  } catch (error) {
    setStatus(`UI init error: ${String(error)}`);
  }
}

void init();



