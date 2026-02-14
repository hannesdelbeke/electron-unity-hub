import type { ProjectEntry, VcsStatus } from "../types";

const tbody = document.querySelector<HTMLTableSectionElement>("#projects-table tbody");
const statusEl = document.getElementById("status");
const searchInput = document.getElementById("search") as HTMLInputElement;
const addToggle = document.getElementById("add-toggle") as HTMLButtonElement;
const addMenu = document.getElementById("add-menu") as HTMLDivElement;
const projectMenuToggle = document.getElementById("project-menu-toggle") as HTMLButtonElement;
const projectMenu = document.getElementById("project-menu") as HTMLDivElement;

const diskDialog = document.getElementById("disk-dialog") as HTMLDialogElement;
const repoDialog = document.getElementById("repo-dialog") as HTMLDialogElement;
const settingsDialog = document.getElementById("settings-dialog") as HTMLDialogElement;

const diskPath = document.getElementById("disk-path") as HTMLInputElement;
const diskNickname = document.getElementById("disk-nickname") as HTMLInputElement;
const diskUnityExe = document.getElementById("disk-unity-exe") as HTMLInputElement;

const repoUrl = document.getElementById("repo-url") as HTMLInputElement;
const repoBranch = document.getElementById("repo-branch") as HTMLInputElement;
const repoTarget = document.getElementById("repo-target") as HTMLInputElement;
const repoNickname = document.getElementById("repo-nickname") as HTMLInputElement;
const repoUnityExe = document.getElementById("repo-unity-exe") as HTMLInputElement;
const settingsDefaultUnityExe = document.getElementById("settings-default-unity-exe") as HTMLInputElement;

let projects: ProjectEntry[] = [];
let selectedId = "";
let searchText = "";
const defaultUnityExeKey = "unityLauncher.defaultUnityExe";

function setStatus(msg: string): void {
  if (statusEl) {
    statusEl.textContent = msg;
  }
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

function getFilteredProjects(): ProjectEntry[] {
  const q = searchText.trim().toLowerCase();
  if (!q) {
    return projects;
  }
  return projects.filter((p) => {
    return [p.nickname, p.name, p.path, p.unityVersion].some((v) => v.toLowerCase().includes(q));
  });
}

function closeAddMenu(): void {
  addMenu.classList.add("hidden");
}

function closeProjectMenu(): void {
  projectMenu.classList.add("hidden");
}

function openDialog(dialogEl: HTMLDialogElement): void {
  closeAddMenu();
  closeProjectMenu();
  dialogEl.showModal();
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

async function renderTable(): Promise<void> {
  if (!tbody) {
    return;
  }

  tbody.innerHTML = "";
  const visible = getFilteredProjects();

  for (const project of visible) {
    const tr = document.createElement("tr");
    tr.dataset.id = project.id;
    if (project.id === selectedId) {
      tr.classList.add("selected");
    }

    const vcs = await window.launcherApi.getVcsStatus(project.path);
    const cells = [
      project.nickname,
      project.name,
      project.path,
      project.unityVersion,
      formatVcs(vcs),
      formatLastOpened(project.lastOpenedIso),
    ];

    for (const value of cells) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    }

    tr.addEventListener("click", () => {
      selectedId = project.id;
      void renderTable();
    });

    tr.addEventListener("dblclick", async () => {
      selectedId = project.id;
      await launchOrFocus();
    });

    tbody.appendChild(tr);
  }
}

async function refreshProjects(): Promise<void> {
  projects = await window.launcherApi.getProjects();
  await renderTable();
  setStatus(`Loaded ${projects.length} projects`);
}

async function saveProject(project: ProjectEntry): Promise<void> {
  const existing = project.id ? projects.find((x) => x.id === project.id) : undefined;
  if (existing && !project.lastOpenedIso) {
    project.lastOpenedIso = existing.lastOpenedIso;
  }
  projects = await window.launcherApi.saveProject(project);
  await renderTable();
}

async function addFromDisk(): Promise<void> {
  const projectPath = diskPath.value.trim();
  if (!projectPath) {
    setStatus("Project folder is required");
    return;
  }

  const version = await window.launcherApi.detectUnityVersion(projectPath);
  const inferredName = projectPath.split(/[\\/]/).filter(Boolean).pop() ?? "Project";

  const project = createProjectEntry({
    path: projectPath,
    name: inferredName,
    nickname: diskNickname.value.trim() || inferredName,
    unityVersion: version,
    unityExe: diskUnityExe.value.trim() || settingsDefaultUnityExe.value.trim(),
  });

  await saveProject(project);
  diskDialog.close();
  diskPath.value = "";
  diskNickname.value = "";
  diskUnityExe.value = "";
  setStatus("Added project from disk");
}

async function addFromRepo(): Promise<void> {
  const url = repoUrl.value.trim();
  const target = repoTarget.value.trim();
  const branch = repoBranch.value.trim();

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
    nickname: repoNickname.value.trim() || inferredName,
    unityVersion: version,
    unityExe: repoUnityExe.value.trim() || settingsDefaultUnityExe.value.trim(),
  });

  await saveProject(project);
  repoDialog.close();
  repoUrl.value = "";
  repoBranch.value = "";
  repoTarget.value = "";
  repoNickname.value = "";
  repoUnityExe.value = "";
  setStatus("Repository cloned and project added");
}

async function launchOrFocus(): Promise<void> {
  if (!selectedId) {
    setStatus("Select a project first");
    return;
  }

  const project = projects.find((p) => p.id === selectedId);
  if (!project) {
    setStatus("Selected project no longer exists");
    return;
  }

  const result = await window.launcherApi.launchOrFocus(project);
  setStatus(result.message);
  await refreshProjects();
}

async function removeSelectedProject(): Promise<void> {
  if (!selectedId) {
    setStatus("Select a project first");
    return;
  }
  projects = await window.launcherApi.deleteProject(selectedId);
  selectedId = "";
  await renderTable();
  setStatus("Project removed");
}

function wireGlobalEvents(): void {
  addToggle.addEventListener("click", () => {
    addMenu.classList.toggle("hidden");
    closeProjectMenu();
  });

  projectMenuToggle.addEventListener("click", () => {
    projectMenu.classList.toggle("hidden");
    closeAddMenu();
  });

  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (!target.closest(".add-wrap")) {
      closeAddMenu();
    }
    if (!target.closest(".project-menu-wrap")) {
      closeProjectMenu();
    }
  });

  searchInput.addEventListener("input", () => {
    searchText = searchInput.value;
    void renderTable();
  });

  document.getElementById("launch-btn")?.addEventListener("click", () => void launchOrFocus());
  document.getElementById("delete-btn")?.addEventListener("click", () => void removeSelectedProject());
  document.getElementById("refresh-btn")?.addEventListener("click", () => void refreshProjects());

  document.getElementById("new-project")?.addEventListener("click", () => {
    void window.launcherApi.openUnityHub();
    setStatus("Opened Unity Hub for new project creation");
  });
  document.getElementById("project-settings")?.addEventListener("click", () => openDialog(settingsDialog));
  document.getElementById("project-remove")?.addEventListener("click", () => void removeSelectedProject());
  document.getElementById("add-hub")?.addEventListener("click", () => {
    closeAddMenu();
    setStatus("Import from Hub will be wired next.");
  });
}

function wireDiskDialog(): void {
  document.getElementById("add-disk")?.addEventListener("click", () => openDialog(diskDialog));

  document.getElementById("disk-browse-path")?.addEventListener("click", async () => {
    const dir = await window.launcherApi.pickDirectory();
    if (dir) {
      diskPath.value = dir;
    }
  });

  document.getElementById("disk-browse-exe")?.addEventListener("click", async () => {
    const file = await window.launcherApi.pickFile();
    if (file) {
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
    if (dir) {
      repoTarget.value = dir;
    }
  });

  document.getElementById("repo-browse-exe")?.addEventListener("click", async () => {
    const file = await window.launcherApi.pickFile();
    if (file) {
      repoUnityExe.value = file;
    }
  });

  document.getElementById("repo-save")?.addEventListener("click", async (event) => {
    event.preventDefault();
    await addFromRepo();
  });
}

function wireSettingsDialog(): void {
  const saved = localStorage.getItem(defaultUnityExeKey);
  if (saved) {
    settingsDefaultUnityExe.value = saved;
  }

  document.getElementById("settings-browse-exe")?.addEventListener("click", async () => {
    const file = await window.launcherApi.pickFile();
    if (file) {
      settingsDefaultUnityExe.value = file;
    }
  });

  document.getElementById("settings-save")?.addEventListener("click", (event) => {
    event.preventDefault();
    localStorage.setItem(defaultUnityExeKey, settingsDefaultUnityExe.value.trim());
    settingsDialog.close();
    setStatus("Settings saved");
  });
}

function init(): void {
  wireGlobalEvents();
  wireDiskDialog();
  wireRepoDialog();
  wireSettingsDialog();
  void refreshProjects();
}

init();
