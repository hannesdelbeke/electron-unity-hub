import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ProjectEntry, VcsStatus } from "./types";

type StoreShape = { projects: ProjectEntry[] };

const dataFile = path.join(app.getAppPath(), "projects.json");

function loadStore(): StoreShape {
  if (!existsSync(dataFile)) {
    return { projects: [] };
  }
  try {
    const payload = JSON.parse(readFileSync(dataFile, "utf-8")) as StoreShape;
    return { projects: payload.projects ?? [] };
  } catch {
    return { projects: [] };
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

function run(cmd: string, args: string[], cwd: string): string {
  const p = spawnSync(cmd, args, { cwd, encoding: "utf-8", timeout: 2000 });
  if (p.status === 0) {
    return (p.stdout ?? "").trim();
  }
  return "";
}

function isGitRepo(projectPath: string): boolean {
  return run("git", ["rev-parse", "--is-inside-work-tree"], projectPath) === "true";
}

function gitStatus(projectPath: string): VcsStatus {
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], projectPath) || "unknown";
  const porcelain = run("git", ["status", "--porcelain"], projectPath);
  return {
    kind: "Git",
    branchOrStream: branch,
    state: porcelain ? "dirty" : "clean",
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
  const opened = run("p4", ["-d", projectPath, "opened", "-m", "1"], projectPath);
  return {
    kind: "Perforce",
    branchOrStream: streamLine ? streamLine.replace("Stream:", "").trim() : "workspace",
    state: opened ? "dirty" : "clean",
  };
}

function getVcsStatus(projectPath: string): VcsStatus {
  if (!existsSync(projectPath)) {
    return { kind: "None", branchOrStream: "", state: "missing path" };
  }
  if (isGitRepo(projectPath)) {
    return gitStatus(projectPath);
  }
  if (isPerforce(projectPath)) {
    return perforceStatus(projectPath);
  }
  return { kind: "None", branchOrStream: "", state: "not detected" };
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

function launchProject(project: ProjectEntry): { ok: boolean; message: string; focused?: boolean } {
  if (projectIsOpen(project.path)) {
    const focused = focusUnityWindow(project.name || project.nickname);
    return {
      ok: focused,
      message: focused ? "Project already open. Focused existing Unity window." : "Project appears open, but focus failed.",
      focused,
    };
  }

  if (!project.unityExe || !existsSync(project.unityExe)) {
    return { ok: false, message: "Unity executable is not set or does not exist." };
  }

  try {
    spawn(project.unityExe, ["-projectPath", project.path], { detached: true, stdio: "ignore" }).unref();
    return { ok: true, message: "Launched Unity project." };
  } catch (error) {
    return { ok: false, message: `Failed to launch: ${String(error)}` };
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

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const htmlPath = path.join(__dirname, "renderer", "index.html");
  win.loadFile(htmlPath);
}

app.whenReady().then(() => {
  const dir = path.dirname(dataFile);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (!existsSync(dataFile)) {
    saveStore({ projects: [] });
  }

  ipcMain.handle("projects:get", () => loadStore().projects);
  ipcMain.handle("projects:save", (_event, project: ProjectEntry) => upsertProject(project));
  ipcMain.handle("projects:delete", (_event, id: string) => deleteProject(id));
  ipcMain.handle("unity:detectVersion", (_event, projectPath: string) => detectUnityVersion(projectPath));
  ipcMain.handle("vcs:status", (_event, projectPath: string) => getVcsStatus(projectPath));
  ipcMain.handle("unity:launchOrFocus", (_event, project: ProjectEntry) => {
    const result = launchProject(project);
    if (result.ok && !result.focused) {
      const updated = { ...project, lastOpenedIso: new Date().toISOString() };
      upsertProject(updated);
    }
    return result;
  });
  ipcMain.handle("ext:openHub", () => shell.openExternal("unityhub://"));
  ipcMain.handle("ext:openDownload", () => shell.openExternal("https://unity.com/download"));
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
