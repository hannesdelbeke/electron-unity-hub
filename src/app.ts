import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from "electron";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ProjectEntry, UnityInstall, VcsStatus } from "./types";

type StoreMeta = {
  firstRunBootstrapDone?: boolean;
};

type StoreShape = {
  projects: ProjectEntry[];
  meta: StoreMeta;
};

const dataFile = path.join(app.getAppPath(), "projects.json");

function normalizePath(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function emptyStore(): StoreShape {
  return {
    projects: [],
    meta: {},
  };
}

function loadStore(): StoreShape {
  if (!existsSync(dataFile)) {
    return emptyStore();
  }
  try {
    const payload = JSON.parse(readFileSync(dataFile, "utf-8")) as Partial<StoreShape>;
    return {
      projects: payload.projects ?? [],
      meta: payload.meta ?? {},
    };
  } catch {
    return emptyStore();
  }
}

function saveStore(store: StoreShape): void {
  writeFileSync(dataFile, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
}

function detectUnityVersion(projectPath: string): string {
  const versionFile = path.join(projectPath, "ProjectSettings", "ProjectVersion.txt");
  if (!existsSync(versionFile)) {
    return "";
  }
  const txt = readFileSync(versionFile, "utf-8");
  const line = txt.split(/\r?\n/).find((x) => x.startsWith("m_EditorVersion:"));
  return line ? line.split(":", 2)[1].trim() : "";
}

function getHubCandidates(): string[] {
  const appData = app.getPath("appData");
  const candidates = [path.join(appData, "UnityHub")];

  if (process.platform === "linux") {
    const home = process.env.HOME ?? "";
    candidates.push(path.join(home, ".config", "UnityHub"));
    candidates.push(path.join(home, ".local", "share", "UnityHub"));
  }

  return [...new Set(candidates)];
}

function findHubFile(fileName: string): string {
  for (const base of getHubCandidates()) {
    const candidate = path.join(base, fileName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return "";
}

function bootstrapFromHubOnFirstRun(store: StoreShape): StoreShape {
  if (store.meta.firstRunBootstrapDone) {
    return store;
  }

  const hubProjectsFile = findHubFile("projects-v1.json");
  if (hubProjectsFile && existsSync(hubProjectsFile)) {
    type HubProject = {
      path?: string;
      title?: string;
      projectName?: string;
      version?: string;
      lastModified?: number;
    };
    type HubPayload = { data?: Record<string, HubProject> };

    try {
      const payload = JSON.parse(readFileSync(hubProjectsFile, "utf-8")) as HubPayload;
      const incoming = payload.data ?? {};
      const existing = new Set(store.projects.map((p) => normalizePath(p.path)));

      for (const [keyPath, item] of Object.entries(incoming)) {
        const projectPath = (item.path ?? keyPath ?? "").trim();
        if (!projectPath) {
          continue;
        }
        const norm = normalizePath(projectPath);
        if (existing.has(norm)) {
          continue;
        }

        const baseName = path.basename(projectPath);
        const displayName = (item.projectName ?? item.title ?? baseName).trim() || baseName;
        const lastOpenedIso =
          typeof item.lastModified === "number" && Number.isFinite(item.lastModified)
            ? new Date(item.lastModified).toISOString()
            : "";

        store.projects.push({
          id: randomUUID(),
          nickname: displayName,
          name: displayName,
          path: projectPath,
          unityVersion: (item.version ?? "").trim() || detectUnityVersion(projectPath),
          unityExe: "",
          lastOpenedIso,
        });
        existing.add(norm);
      }
    } catch {
      // Ignore malformed hub cache.
    }
  }

  store.meta.firstRunBootstrapDone = true;
  saveStore(store);
  return store;
}

function inferVersionFromPath(exePath: string, fallback = "unknown"): string {
  const parts = exePath.split(/[\\/]/);
  for (const part of parts) {
    if (/^\d{4}\.\d+\.\d+[a-z]\d+$/i.test(part) || /^\d+\.\d+\.\d+[a-z]\d+$/i.test(part)) {
      return part;
    }
  }
  return fallback;
}

function addInstall(candidates: UnityInstall[], seen: Set<string>, install: UnityInstall): void {
  const normalized = normalizePath(install.path);
  if (seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  candidates.push(install);
}

function addInstallIfExists(candidates: UnityInstall[], seen: Set<string>, install: UnityInstall): void {
  if (!install.exists) {
    return;
  }
  addInstall(candidates, seen, install);
}

function scanInstallRoot(baseRoot: string, candidates: UnityInstall[], seen: Set<string>, source: string): void {
  if (!existsSync(baseRoot)) {
    return;
  }
  let entries: string[] = [];
  try {
    entries = readdirSync(baseRoot);
  } catch {
    return;
  }

  for (const entry of entries) {
    const editorPath = process.platform === "darwin"
      ? path.join(baseRoot, entry, "Unity.app")
      : process.platform === "win32"
        ? path.join(baseRoot, entry, "Editor", "Unity.exe")
        : path.join(baseRoot, entry, "Editor", "Unity");

    addInstall(candidates, seen, {
      version: inferVersionFromPath(editorPath),
      path: editorPath,
      source,
      exists: existsSync(editorPath),
    });
  }
}

function loadHubEditorMetadata(candidates: UnityInstall[], seen: Set<string>): void {
  const file = findHubFile("editors-v2.json");
  if (!file || !existsSync(file)) {
    return;
  }

  type HubEditor = {
    version?: string;
    location?: string[];
  };
  type HubPayload = {
    data?: HubEditor[];
  };

  try {
    const payload = JSON.parse(readFileSync(file, "utf-8")) as HubPayload;
    for (const item of payload.data ?? []) {
      for (const location of item.location ?? []) {
        addInstall(candidates, seen, {
          version: inferVersionFromPath(location, item.version ?? "unknown"),
          path: location,
          source: "Unity Hub metadata",
          exists: existsSync(location),
        });
      }
    }
  } catch {
    // Ignore malformed hub cache.
  }
}

function getUnityInstalls(): UnityInstall[] {
  const installs: UnityInstall[] = [];
  const seen = new Set<string>();

  if (process.platform === "win32") {
    const pf = process.env.ProgramFiles ?? "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    scanInstallRoot(path.join(pf, "Unity", "Hub", "Editor"), installs, seen, "Hub-style path");
    scanInstallRoot(path.join(pf86, "Unity", "Hub", "Editor"), installs, seen, "Hub-style path");
    addInstallIfExists(installs, seen, {
      version: "legacy",
      path: path.join(pf, "Unity", "Editor", "Unity.exe"),
      source: "Legacy Unity path",
      exists: existsSync(path.join(pf, "Unity", "Editor", "Unity.exe")),
    });
    addInstallIfExists(installs, seen, {
      version: "legacy",
      path: path.join(pf86, "Unity", "Editor", "Unity.exe"),
      source: "Legacy Unity path",
      exists: existsSync(path.join(pf86, "Unity", "Editor", "Unity.exe")),
    });
  } else if (process.platform === "darwin") {
    scanInstallRoot("/Applications/Unity/Hub/Editor", installs, seen, "Hub-style path");
    addInstallIfExists(installs, seen, {
      version: "legacy",
      path: "/Applications/Unity/Unity.app",
      source: "Legacy Unity path",
      exists: existsSync("/Applications/Unity/Unity.app"),
    });
  } else {
    const home = process.env.HOME ?? "";
    scanInstallRoot(path.join(home, ".local", "share", "unity3d", "Hub", "Editor"), installs, seen, "Hub-style path");
    scanInstallRoot("/opt/Unity/Hub/Editor", installs, seen, "System");
    addInstallIfExists(installs, seen, {
      version: "legacy",
      path: "/opt/Unity/Editor/Unity",
      source: "Legacy Unity path",
      exists: existsSync("/opt/Unity/Editor/Unity"),
    });
  }

  loadHubEditorMetadata(installs, seen);

  return installs.sort((a, b) => {
    if (a.exists !== b.exists) {
      return a.exists ? -1 : 1;
    }
    return a.version.localeCompare(b.version, undefined, { numeric: true });
  });
}

function run(cmd: string, args: string[], cwd: string): string {
  const p = spawnSync(cmd, args, { cwd, encoding: "utf-8", timeout: 2000 });
  if (p.status === 0) {
    return (p.stdout ?? "").trim();
  }
  return "";
}

function countNonEmptyLines(value: string): number {
  if (!value.trim()) {
    return 0;
  }
  return value.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

const vcsCache = new Map<string, { status: VcsStatus; refreshedAt: number }>();
const vcsCacheTtlMs = 30_000;

function isGitRepo(projectPath: string): boolean {
  return run("git", ["rev-parse", "--is-inside-work-tree"], projectPath) === "true";
}

function gitStatus(projectPath: string): VcsStatus {
  const statusBranch = run("git", ["status", "--porcelain=v1", "--branch"], projectPath);
  const lines = statusBranch.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const header = lines.find((line) => line.startsWith("##")) ?? "";
  const changeLines = lines.filter((line) => !line.startsWith("##"));
  const localChangesCount = changeLines.length;
  const branchMatch = header.match(/^##\s+([^\s.]+)/);
  const fallbackBranch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], projectPath);
  const branch = (branchMatch?.[1] ?? fallbackBranch) || "unknown";

  const aheadMatch = header.match(/ahead (\d+)/i);
  const behindMatch = header.match(/behind (\d+)/i);
  const outgoingCount = aheadMatch ? Number.parseInt(aheadMatch[1], 10) : 0;
  const incomingCount = behindMatch ? Number.parseInt(behindMatch[1], 10) : 0;
  const nowIso = new Date().toISOString();

  return {
    providerId: "git",
    icon: "git",
    kind: "Git",
    branchOrStream: branch,
    state: localChangesCount > 0 ? "dirty" : "clean",
    localChangesCount,
    incomingCount,
    outgoingCount,
    pendingWorkItemsCount: null,
    lastRefreshIso: nowIso,
    message: localChangesCount > 0 ? "Local changes detected" : "Clean working tree",
    supports: {
      incomingOutgoing: true,
      pendingWorkItems: false,
    },
  };
}

function isPerforce(projectPath: string): boolean {
  const out = run("p4", ["-d", projectPath, "info"], projectPath);
  return out.length > 0;
}

function perforceStatus(projectPath: string): VcsStatus {
  const streamLine = run("p4", ["-d", projectPath, "client", "-o"], projectPath)
    .split(/\r?\n/)
    .find((line) => line.startsWith("Stream:"));
  const opened = run("p4", ["-d", projectPath, "opened", "-m", "200"], projectPath);
  const pendingChanges = run("p4", ["-d", projectPath, "changes", "-s", "pending", "-m", "25"], projectPath);
  const localChangesCount = countNonEmptyLines(opened);
  const pendingWorkItemsCount = countNonEmptyLines(pendingChanges);
  const nowIso = new Date().toISOString();
  return {
    providerId: "perforce",
    icon: "perforce",
    kind: "Perforce",
    branchOrStream: streamLine ? streamLine.replace("Stream:", "").trim() : "workspace",
    state: localChangesCount > 0 ? "dirty" : "clean",
    localChangesCount,
    incomingCount: null,
    outgoingCount: null,
    pendingWorkItemsCount,
    lastRefreshIso: nowIso,
    message: localChangesCount > 0 ? "Opened files detected" : "No opened files",
    supports: {
      incomingOutgoing: false,
      pendingWorkItems: true,
    },
  };
}

function computeVcsStatus(projectPath: string): VcsStatus {
  if (!existsSync(projectPath)) {
    return {
      providerId: "none",
      icon: "none",
      kind: "None",
      branchOrStream: "",
      state: "missing path",
      localChangesCount: 0,
      incomingCount: null,
      outgoingCount: null,
      pendingWorkItemsCount: null,
      lastRefreshIso: new Date().toISOString(),
      supports: {
        incomingOutgoing: false,
        pendingWorkItems: false,
      },
    };
  }
  if (isGitRepo(projectPath)) {
    return gitStatus(projectPath);
  }
  if (isPerforce(projectPath)) {
    return perforceStatus(projectPath);
  }
  return {
    providerId: "none",
    icon: "none",
    kind: "None",
    branchOrStream: "",
    state: "not detected",
    localChangesCount: 0,
    incomingCount: null,
    outgoingCount: null,
    pendingWorkItemsCount: null,
    lastRefreshIso: new Date().toISOString(),
    supports: {
      incomingOutgoing: false,
      pendingWorkItems: false,
    },
  };
}

function getVcsStatus(projectPath: string): VcsStatus {
  const cacheKey = normalizePath(projectPath);
  const cached = vcsCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.refreshedAt < vcsCacheTtlMs) {
    return cached.status;
  }
  const status = computeVcsStatus(projectPath);
  vcsCache.set(cacheKey, { status, refreshedAt: now });
  return status;
}

function refreshVcsStatus(projectPath: string): VcsStatus {
  if (isGitRepo(projectPath)) {
    spawnSync("git", ["fetch", "--prune", "--quiet"], {
      cwd: projectPath,
      encoding: "utf-8",
      timeout: 15000,
    });
  }
  const status = computeVcsStatus(projectPath);
  vcsCache.set(normalizePath(projectPath), { status, refreshedAt: Date.now() });
  return status;
}

function projectIsOpen(projectPath: string): boolean {
  return existsSync(path.join(projectPath, "Temp", "UnityLockfile"));
}

function focusUnityWindow(projectName: string): boolean {
  if (process.platform !== "win32") {
    return false;
  }

  const script = `
$wshell = New-Object -ComObject WScript.Shell
if ($wshell.AppActivate('${projectName.replace(/'/g, "''")}')) { exit 0 }
if ($wshell.AppActivate('Unity')) { exit 0 }
exit 1
`;
  const p = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf-8", timeout: 3000 });
  return p.status === 0;
}

function launchProject(project: ProjectEntry): {
  ok: boolean;
  message: string;
  focused?: boolean;
  resolvedUnityExe?: string;
} {
  if (!existsSync(project.path)) {
    return { ok: false, message: "Project path does not exist." };
  }

  const projectVersion = project.unityVersion.trim().toLowerCase();
  const existingExe = project.unityExe.trim();
  let resolvedExe = existingExe;
  if (!resolvedExe || !existsSync(resolvedExe)) {
    const installs = getUnityInstalls().filter((install) => install.exists);
    const exact = installs.find((install) => install.version.trim().toLowerCase() === projectVersion);
    const compatible = installs.find((install) => {
      const v = install.version.trim().toLowerCase();
      return v.startsWith(projectVersion) || projectVersion.startsWith(v);
    });
    resolvedExe = exact?.path ?? compatible?.path ?? installs[0]?.path ?? "";
  }

  let prefix = "";
  if (projectIsOpen(project.path)) {
    const focused = focusUnityWindow(project.name || project.nickname);
    if (focused) {
      return {
        ok: true,
        message: "Project already open. Focused existing Unity window.",
        focused,
        resolvedUnityExe: resolvedExe,
      };
    }
    prefix = "Project appears open, but focus failed. Attempting launch. ";
  }

  if (!resolvedExe || !existsSync(resolvedExe)) {
    return { ok: false, message: "Unity executable is not set or does not exist." };
  }

  try {
    spawn(resolvedExe, ["-projectPath", project.path], { detached: true, stdio: "ignore" }).unref();
    return {
      ok: true,
      message: `${prefix}Launched Unity project.`,
      resolvedUnityExe: resolvedExe,
    };
  } catch (error) {
    return { ok: false, message: `Failed to launch: ${String(error)}` };
  }
}

function launchUnityEditor(editorPath: string): { ok: boolean; message: string } {
  if (!existsSync(editorPath)) {
    return { ok: false, message: "Unity editor path does not exist." };
  }
  try {
    spawn(editorPath, [], { detached: true, stdio: "ignore" }).unref();
    return { ok: true, message: "Launched Unity editor." };
  } catch (error) {
    return { ok: false, message: `Failed to launch editor: ${String(error)}` };
  }
}

function cloneRepository(repoUrl: string, targetDir: string, branch: string): { ok: boolean; message: string } {
  if (!repoUrl.trim()) {
    return { ok: false, message: "Repository URL is required." };
  }
  if (!targetDir.trim()) {
    return { ok: false, message: "Target directory is required." };
  }

  const args = ["clone"];
  if (branch.trim()) {
    args.push("--branch", branch.trim());
  }
  args.push(repoUrl.trim(), targetDir.trim());

  const p = spawnSync("git", args, { encoding: "utf-8", timeout: 120000 });
  if (p.status === 0) {
    return { ok: true, message: "Repository cloned." };
  }
  const stderr = (p.stderr ?? "").trim();
  return { ok: false, message: stderr || "Failed to clone repository." };
}

function upsertProject(incoming: ProjectEntry): ProjectEntry[] {
  const store = loadStore();
  const project = { ...incoming };
  if (!project.id) {
    project.id = randomUUID();
  }
  if (!project.name.trim()) {
    project.name = path.basename(project.path);
  }
  if (!project.nickname.trim()) {
    project.nickname = project.name;
  }
  if (!project.unityVersion.trim()) {
    project.unityVersion = detectUnityVersion(project.path);
  }

  const idx = store.projects.findIndex((x) => x.id === project.id);
  if (idx >= 0) {
    store.projects[idx] = project;
  } else {
    store.projects.push(project);
  }
  saveStore(store);
  return store.projects;
}

function deleteProject(id: string): ProjectEntry[] {
  const store = loadStore();
  store.projects = store.projects.filter((x) => x.id !== id);
  saveStore(store);
  return store.projects;
}

function removeMissingProjects(): { removed: number; remaining: number } {
  const store = loadStore();
  const before = store.projects.length;
  store.projects = store.projects.filter((p) => existsSync(p.path));
  const removed = before - store.projects.length;
  saveStore(store);
  return { removed, remaining: store.projects.length };
}

function createWindow(): void {
  const bgColor = nativeTheme.shouldUseDarkColors ? "#111418" : "#f6f7f8";
  const win = new BrowserWindow({
    width: 1280,
    height: 760,
    show: false,
    backgroundColor: bgColor,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);

  const htmlPath = path.join(__dirname, "renderer", "index.html");
  win.loadFile(htmlPath);
  win.once("ready-to-show", () => {
    win.show();
  });
}

app.whenReady().then(() => {
  const dir = path.dirname(dataFile);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const store = loadStore();
  const bootstrapped = bootstrapFromHubOnFirstRun(store);
  saveStore(bootstrapped);

  ipcMain.handle("projects:get", () => loadStore().projects);
  ipcMain.handle("projects:save", (_event, project: ProjectEntry) => upsertProject(project));
  ipcMain.handle("projects:delete", (_event, id: string) => deleteProject(id));
  ipcMain.handle("projects:removeMissing", () => removeMissingProjects());
  ipcMain.handle("unity:detectVersion", (_event, projectPath: string) => detectUnityVersion(projectPath));
  ipcMain.handle("vcs:status", (_event, projectPath: string) => getVcsStatus(projectPath));
  ipcMain.handle("vcs:refresh", (_event, projectPath: string) => refreshVcsStatus(projectPath));
  ipcMain.handle("unity:installs", () => getUnityInstalls());
  ipcMain.handle("unity:launchOrFocus", (_event, project: ProjectEntry) => {
    const result = launchProject(project);
    if (result.ok && !result.focused) {
      const updated = {
        ...project,
        unityExe: result.resolvedUnityExe || project.unityExe,
        lastOpenedIso: new Date().toISOString(),
      };
      upsertProject(updated);
    }
    return result;
  });
  ipcMain.handle("unity:launchEditor", (_event, editorPath: string) => launchUnityEditor(editorPath));
  ipcMain.handle("dialog:pickDirectory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return "";
    }
    return result.filePaths[0];
  });
  ipcMain.handle("dialog:pickFile", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        { name: "Executables", extensions: ["exe", "app"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return "";
    }
    return result.filePaths[0];
  });
  ipcMain.handle("repo:clone", (_event, repoUrl: string, targetDir: string, branch: string) =>
    cloneRepository(repoUrl, targetDir, branch),
  );

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
