type ProjectEntry = {
  id: string;
  nickname: string;
  name: string;
  path: string;
  unityVersion: string;
  unityExe: string;
  lastOpenedIso: string;
};

type VcsStatus = {
  kind: string;
  branchOrStream: string;
  state: string;
};

type UnityInstall = {
  version: string;
  path: string;
  source: string;
  exists: boolean;
};

type ThemePreference = "system" | "dark" | "light";
type SortDirection = "asc" | "desc";
type ProjectSortKey = "displayName" | "path" | "unityVersion" | "vcs" | "lastOpenedIso" | "status";
type InstallSortKey = "version" | "path" | "source" | "status";

type ProjectTableRow = {
  project: ProjectEntry;
  vcs: VcsStatus;
  isMissing: boolean;
};

const tbody = document.querySelector<HTMLTableSectionElement>("#projects-table tbody");
const installsTbody = document.querySelector<HTMLTableSectionElement>("#installs-table tbody");
const statusEl = document.getElementById("status");
const searchInput = document.getElementById("search") as HTMLInputElement | null;
const addToggle = document.getElementById("add-toggle") as HTMLButtonElement | null;
const addMenu = document.getElementById("add-menu") as HTMLDivElement | null;

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
const settingsDisableRenderThrottling =
  document.getElementById("settings-disable-render-throttling") as HTMLInputElement | null;
const projectSettingsNickname = document.getElementById("project-settings-nickname") as HTMLInputElement | null;

const tabProjects = document.getElementById("tab-projects");
const tabInstalls = document.getElementById("tab-installs");
const tabSettings = document.getElementById("tab-settings");

const viewProjects = document.getElementById("view-projects");
const viewInstalls = document.getElementById("view-installs");
const viewSettings = document.getElementById("view-settings");
const topbarProjects = document.getElementById("topbar-projects");
const topbarInstalls = document.getElementById("topbar-installs");
const topbarSettings = document.getElementById("topbar-settings");

let projects: ProjectEntry[] = [];
let installs: UnityInstall[] = [];
let selectedId = "";
let searchText = "";
let openProjectMenuId = "";
let openInstallMenuPath = "";
let editingProjectId = "";
let didInit = false;
let projectsRenderToken = 0;
let projectSort: { key: ProjectSortKey; direction: SortDirection } = { key: "lastOpenedIso", direction: "desc" };
let installSort: { key: InstallSortKey; direction: SortDirection } = { key: "version", direction: "asc" };

const defaultUnityExeKey = "unityLauncher.defaultUnityExe";
const themePreferenceKey = "unityLauncher.themePreference";
const dismissedInstallsKey = "unityLauncher.dismissedInstalls";

type TabName = "projects" | "installs" | "settings";

function setStatus(msg: string): void {
  if (statusEl) {
    statusEl.textContent = msg;
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

  topbarProjects?.classList.toggle("active", tab === "projects");
  topbarInstalls?.classList.toggle("active", tab === "installs");
  topbarSettings?.classList.toggle("active", tab === "settings");
}

function formatVcs(vcs: VcsStatus): string {
  if (vcs.kind === "None") {
    return "None";
  }
  const branch = vcs.branchOrStream ? ` ${vcs.branchOrStream}` : "";
  return `${vcs.kind}${branch} (${vcs.state})`;
}

function formatLastOpened(iso: string): string {
  if (!iso) {
    return "never";
  }
  return new Date(iso).toLocaleString();
}

function warningLabel(missing: boolean): string {
  return missing ? "<span class=\"warning-pill\">Missing</span>" : "";
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
      header.textContent = `${label} ${direction === "asc" ? "▲" : "▼"}`;
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
  return projects.filter((p) => [getDisplayName(p), p.name, p.path, p.unityVersion].some((v) => v.toLowerCase().includes(q)));
}

function closeAddMenu(): void {
  addMenu?.classList.add("hidden");
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
}

function closeInstallRowMenus(): void {
  openInstallMenuPath = "";
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

function dedupeProjects(input: ProjectEntry[]): ProjectEntry[] {
  const seen = new Set<string>();
  const result: ProjectEntry[] = [];
  for (const project of input) {
    const key = [
      project.path.trim().toLowerCase(),
      project.nickname.trim().toLowerCase(),
      project.name.trim().toLowerCase(),
      project.unityVersion.trim().toLowerCase(),
      project.unityExe.trim().toLowerCase(),
    ].join("|");
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
  setStatus(result.message);
  await refreshProjects(false);
}

function openProjectSettings(project: ProjectEntry): void {
  editingProjectId = project.id;
  if (projectSettingsNickname) {
    projectSettingsNickname.value = project.nickname;
  }
  projectSettingsDialog?.showModal();
}

async function removeProjectById(id: string): Promise<void> {
  projects = await window.launcherApi.deleteProject(id);
  if (selectedId === id) {
    selectedId = "";
  }
  if (editingProjectId === id) {
    editingProjectId = "";
    projectSettingsDialog?.close();
  }
  await renderProjectsTable();
  setStatus("Project removed");
}

async function renderProjectsTable(): Promise<void> {
  if (!tbody) {
    return;
  }

  const token = ++projectsRenderToken;
  const visible = getFilteredProjects();
  const rows: ProjectTableRow[] = await Promise.all(
    visible.map(async (project) => {
      const vcs = await window.launcherApi.getVcsStatus(project.path);
      return {
        project,
        vcs,
        isMissing: vcs.state === "missing path",
      };
    }),
  );

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
        left = formatVcs(a.vcs);
        right = formatVcs(b.vcs);
        break;
      case "lastOpenedIso":
        left = parseTimestamp(a.project.lastOpenedIso);
        right = parseTimestamp(b.project.lastOpenedIso);
        break;
      case "status":
        left = a.isMissing;
        right = b.isMissing;
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

    const values: Array<string> = [
      getDisplayName(project),
      project.path,
      project.unityVersion,
      formatVcs(vcs),
      formatLastOpened(project.lastOpenedIso),
      warningLabel(isMissing),
    ];

    for (let i = 0; i < values.length; i += 1) {
      const td = document.createElement("td");
      if (i === values.length - 1) {
        td.innerHTML = values[i];
      } else {
        td.textContent = values[i];
      }
      tr.appendChild(td);
    }

    const actionsTd = document.createElement("td");
    const actionsWrap = document.createElement("div");
    actionsWrap.className = "row-actions";
    const actionsButton = document.createElement("button");
    actionsButton.className = "icon-btn row-action-btn";
    actionsButton.type = "button";
    actionsButton.textContent = "…";
    actionsButton.setAttribute("aria-label", "Project actions");
    actionsButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openProjectMenuId = openProjectMenuId === project.id ? "" : project.id;
      void renderProjectsTable();
    });
    actionsWrap.appendChild(actionsButton);

    const rowMenu = document.createElement("div");
    rowMenu.className = `menu row-menu${openProjectMenuId === project.id ? "" : " hidden"}`;
    rowMenu.addEventListener("click", (event) => event.stopPropagation());

    const settingsBtn = document.createElement("button");
    settingsBtn.className = "menu-item";
    settingsBtn.type = "button";
    settingsBtn.textContent = "Settings";
    settingsBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      closeProjectRowMenus();
      openProjectSettings(project);
      void renderProjectsTable();
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "menu-item danger-item";
    removeBtn.type = "button";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      closeProjectRowMenus();
      await removeProjectById(project.id);
    });

    rowMenu.appendChild(settingsBtn);
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
      await launchProjectRow(project);
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
  const sortedInstalls = [...installs].sort((a, b) => {
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
      install.version,
      install.path,
      install.source,
      warningLabel(!install.exists),
    ];

    for (let i = 0; i < values.length; i += 1) {
      const td = document.createElement("td");
      if (i === values.length - 1) {
        td.innerHTML = values[i];
      } else {
        td.textContent = values[i];
      }
      tr.appendChild(td);
    }

    tr.addEventListener("click", async () => {
      if (!install.exists) {
        setStatus("Unity install path is missing");
        return;
      }
      const result = await window.launcherApi.launchUnityEditor(install.path);
      setStatus(result.message);
    });

    installsTbody.appendChild(tr);
  }
}

async function refreshProjects(updateStatus = true): Promise<void> {
  projects = dedupeProjects(await window.launcherApi.getProjects());
  await renderProjectsTable();
  if (updateStatus) {
    setStatus(`Loaded ${projects.length} projects`);
  }
}

async function refreshInstalls(updateStatus = true): Promise<void> {
  installs = await window.launcherApi.getUnityInstalls();
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
  projects = await window.launcherApi.saveProject(project);
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

  setStatus("Cloning repository...");
  const clone = await window.launcherApi.cloneRepo(url, target, branch);
  if (!clone.ok) {
    setStatus(clone.message);
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
      void renderProjectsTable();
    }
  });

  searchInput?.addEventListener("input", () => {
    searchText = searchInput.value;
    void renderProjectsTable();
  });

  document.getElementById("refresh-btn")?.addEventListener("click", () => void refreshProjects());
  document.getElementById("refresh-installs")?.addEventListener("click", () => void refreshInstalls());

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
    await refreshProjects(false);
  } catch (error) {
    setStatus(`UI init error: ${String(error)}`);
  }
}

void init();
