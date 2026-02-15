import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import { execFile, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ProjectEntry, UnityInstall, VcsStatus } from "./types";

type StoreMeta = {
  firstRunBootstrapDone?: boolean;
  disableRenderThrottling?: boolean;
  cloudProjects?: ProjectEntry[];
  cloudLastSyncIso?: string;
  cloudMetaRefreshedIso?: string;
};

type StoreShape = {
  projects: ProjectEntry[];
  meta: StoreMeta;
};

function getDataFile(): string {
  return path.join(app.getPath("userData"), "projects.json");
}

type GitHubAuthStatus = {
  ghInstalled: boolean;
  ghAuthenticated: boolean;
  connected: boolean;
  login: string;
  source: "gh" | "none";
  installHint: string;
  installUrl: string;
  message: string;
};

type GitHubRepo = {
  name: string;
  full_name: string;
  clone_url: string;
  default_branch: string;
  private: boolean;
  pushed_at?: string;
  size?: number;
};

type GitHubUser = {
  login: string;
};

type GitLabRepo = {
  id: number;
  name: string;
  path_with_namespace: string;
  http_url_to_repo: string;
  default_branch?: string;
  last_activity_at?: string;
  statistics?: {
    repository_size?: number;
  };
};

type GitLabUser = {
  username: string;
};

function getGhInstallHint(): string {
  if (process.platform === "win32") {
    return "Install with winget: winget install --id GitHub.cli";
  }
  if (process.platform === "darwin") {
    return "Install with Homebrew: brew install gh";
  }
  return "Install with your package manager (apt/dnf/pacman) or from cli.github.com";
}

function getGlabInstallHint(): string {
  if (process.platform === "win32") {
    return "Install with winget: winget install --id GLab.GLab";
  }
  if (process.platform === "darwin") {
    return "Install with Homebrew: brew install glab";
  }
  return "Install with your package manager (apt/dnf/pacman) or from gitlab.com/gitlab-org/cli";
}

function getHubInstallHint(): string {
  if (process.platform === "win32") {
    return "Install with winget: winget install --id Unity.UnityHub";
  }
  if (process.platform === "darwin") {
    return "Install with Homebrew: brew install --cask unity-hub";
  }
  return "Install Unity Hub from unity.com or your distro package manager.";
}

function getGitInstallHint(): string {
  if (process.platform === "win32") {
    return "Install with winget: winget install --id Git.Git";
  }
  if (process.platform === "darwin") {
    return "Install with Homebrew: brew install git";
  }
  return "Install with your package manager (apt/dnf/pacman).";
}

function installCommandForGh(): string {
  if (process.platform === "win32") {
    return "winget install --id GitHub.cli -e --source winget";
  }
  if (process.platform === "darwin") {
    return "brew install gh";
  }
  return "echo \"Install GH CLI using your distro package manager (apt/dnf/pacman)\"";
}

function installCommandForGlab(): string {
  if (process.platform === "win32") {
    return "winget install --id GLab.GLab -e --source winget";
  }
  if (process.platform === "darwin") {
    return "brew install glab";
  }
  return "echo \"Install GitLab CLI (glab) using your distro package manager (apt/dnf/pacman)\"";
}

function installCommandForHub(): string {
  if (process.platform === "win32") {
    return "winget install --id Unity.UnityHub -e --source winget";
  }
  if (process.platform === "darwin") {
    return "brew install --cask unity-hub";
  }
  return "echo \"Install Unity Hub manually for Linux.\"";
}

function installCommandForGit(): string {
  if (process.platform === "win32") {
    return "winget install --id Git.Git -e --source winget";
  }
  if (process.platform === "darwin") {
    return "brew install git";
  }
  return "echo \"Install Git using your distro package manager (apt/dnf/pacman)\"";
}

function normalizePath(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function normalizeUrlKey(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function parseGitHubRepoKeyFromUrl(remoteUrl: string): string {
  const value = remoteUrl.trim();
  if (!value) {
    return "";
  }
  const https = value.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (https) {
    return `${https[1]}/${https[2]}`.toLowerCase();
  }
  const scp = value.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (scp) {
    return `${scp[1]}/${scp[2]}`.toLowerCase();
  }
  const ssh = value.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (ssh) {
    return `${ssh[1]}/${ssh[2]}`.toLowerCase();
  }
  return "";
}

function emptyStore(): StoreShape {
  return {
    projects: [],
    meta: {},
  };
}

function loadStore(): StoreShape {
  const dataFile = getDataFile();
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
  const dataFile = getDataFile();
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

const projectIconCache = new Map<string, string>();
const guidPathCache = new Map<string, string>();
const projectLastCommitCache = new Map<string, { iso: string; computedAtMs: number; gitIndexMtimeMs: number }>();
type ProjectSizeCacheEntry = {
  bytes: number;
  computedAtMs: number;
  mode: "git-tracked" | "filtered";
  gitIndexMtimeMs?: number;
};

const projectSizeCache = new Map<string, ProjectSizeCacheEntry>();
const projectSizeCacheTtlMs = 300_000;
const projectLastCommitCacheTtlMs = 60_000;

function mimeFromExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function toDataUrl(filePath: string): string {
  if (!existsSync(filePath)) {
    return "";
  }
  try {
    const bytes = readFileSync(filePath);
    return `data:${mimeFromExtension(filePath)};base64,${bytes.toString("base64")}`;
  } catch {
    return "";
  }
}

function findAssetByGuid(assetsRoot: string, guid: string): string {
  const guidKey = guid.toLowerCase();
  const cached = guidPathCache.get(guidKey);
  if (cached && existsSync(cached)) {
    return cached;
  }

  const stack: string[] = [assetsRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !existsSync(current)) {
      continue;
    }

    let entries: ReturnType<typeof readdirSync> | Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      entries = readdirSync(current, { withFileTypes: true }) as Array<{
        name: string;
        isDirectory: () => boolean;
        isFile: () => boolean;
      }>;
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".meta")) {
        continue;
      }
      try {
        const txt = readFileSync(fullPath, "utf-8");
        if (!txt.includes(`guid: ${guid}`)) {
          continue;
        }
        const assetPath = fullPath.slice(0, -".meta".length);
        guidPathCache.set(guidKey, assetPath);
        return assetPath;
      } catch {
        // Ignore unreadable meta file.
      }
    }
  }
  return "";
}

function detectProjectIconDataUrl(projectPath: string): string {
  const cacheKey = normalizePath(projectPath);
  if (projectIconCache.has(cacheKey)) {
    return projectIconCache.get(cacheKey) ?? "";
  }

  const settingsPath = path.join(projectPath, "ProjectSettings", "ProjectSettings.asset");
  if (!existsSync(settingsPath)) {
    projectIconCache.set(cacheKey, "");
    return "";
  }

  let settingsText = "";
  try {
    settingsText = readFileSync(settingsPath, "utf-8");
  } catch {
    projectIconCache.set(cacheKey, "");
    return "";
  }

  const iconStart = settingsText.indexOf("m_BuildTargetIcons:");
  const iconSection = iconStart >= 0 ? settingsText.slice(iconStart, iconStart + 100_000) : settingsText;
  const guidMatches = [...iconSection.matchAll(/guid:\s*([0-9a-f]{32})/gi)];
  if (guidMatches.length === 0) {
    projectIconCache.set(cacheKey, "");
    return "";
  }

  const assetsRoot = path.join(projectPath, "Assets");
  for (const match of guidMatches) {
    const guid = (match[1] ?? "").toLowerCase();
    if (!guid) {
      continue;
    }
    const assetPath = findAssetByGuid(assetsRoot, guid);
    if (!assetPath) {
      continue;
    }
    const iconDataUrl = toDataUrl(assetPath);
    if (!iconDataUrl) {
      continue;
    }
    projectIconCache.set(cacheKey, iconDataUrl);
    return iconDataUrl;
  }

  projectIconCache.set(cacheKey, "");
  return "";
}

function shouldSkipGeneratedDirectory(dirName: string): boolean {
  const name = dirName.toLowerCase();
  return name === "library"
    || name === "temp"
    || name === "obj"
    || name === "logs"
    || name === "usersettings"
    || name === "packagecache"
    || name === ".git";
}

function computeFilteredDirectorySizeBytes(projectPath: string): number {
  if (!existsSync(projectPath)) {
    return 0;
  }

  const stack: string[] = [projectPath];
  let totalBytes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    let entries: ReturnType<typeof readdirSync> | Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      entries = readdirSync(current, { withFileTypes: true }) as Array<{
        name: string;
        isDirectory: () => boolean;
        isFile: () => boolean;
      }>;
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipGeneratedDirectory(entry.name)) {
          continue;
        }
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      try {
        totalBytes += statSync(fullPath).size;
      } catch {
        // Ignore unreadable files.
      }
    }
  }

  return totalBytes;
}

function resolveGitDir(projectPath: string): string {
  const gitDir = run("git", ["rev-parse", "--git-dir"], projectPath);
  if (!gitDir) {
    return "";
  }
  return path.isAbsolute(gitDir) ? gitDir : path.join(projectPath, gitDir);
}

function readGitTrackedFiles(projectPath: string): string[] | null {
  const p = spawnSync("git", ["ls-files", "-z"], {
    cwd: projectPath,
    encoding: "utf-8",
    timeout: 5000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (p.status !== 0) {
    return null;
  }
  return (p.stdout ?? "").split("\0").filter((item) => item.length > 0);
}

function computeGitTrackedSizeBytes(projectPath: string): number | null {
  const files = readGitTrackedFiles(projectPath);
  if (files === null) {
    return null;
  }
  if (files.length === 0) {
    return 0;
  }
  let totalBytes = 0;
  for (const relativePath of files) {
    const fullPath = path.join(projectPath, relativePath);
    try {
      const info = statSync(fullPath);
      if (info.isFile()) {
        totalBytes += info.size;
      }
    } catch {
      // Ignore unreadable/missing tracked files.
    }
  }
  return totalBytes;
}

function getProjectSizeBytes(projectPath: string): number {
  if (!existsSync(projectPath)) {
    return 0;
  }
  const cacheKey = normalizePath(projectPath);
  const cached = projectSizeCache.get(cacheKey);
  const now = Date.now();
  const ttlValid = cached && (now - cached.computedAtMs) < projectSizeCacheTtlMs;

  const gitRepo = isGitRepo(projectPath);
  if (gitRepo) {
    const gitDir = resolveGitDir(projectPath);
    const indexPath = gitDir ? path.join(gitDir, "index") : "";
    const indexMtimeMs = indexPath && existsSync(indexPath) ? statSync(indexPath).mtimeMs : 0;

    if (
      ttlValid
      && cached?.mode === "git-tracked"
      && cached.gitIndexMtimeMs === indexMtimeMs
    ) {
      return cached.bytes;
    }

    const trackedBytes = computeGitTrackedSizeBytes(projectPath);
    if (trackedBytes !== null) {
      projectSizeCache.set(cacheKey, { bytes: trackedBytes, computedAtMs: now, mode: "git-tracked", gitIndexMtimeMs: indexMtimeMs });
      return trackedBytes;
    }
    projectSizeCache.set(cacheKey, { bytes: 0, computedAtMs: now, mode: "git-tracked", gitIndexMtimeMs: indexMtimeMs });
    return 0;
  }

  if (ttlValid && cached?.mode === "filtered") {
    return cached.bytes;
  }

  const bytes = computeFilteredDirectorySizeBytes(projectPath);
  projectSizeCache.set(cacheKey, { bytes, computedAtMs: now, mode: "filtered" });
  return bytes;
}

async function getProjectLastCommitIso(projectPath: string): Promise<string> {
  if (!existsSync(projectPath) || !isGitRepo(projectPath)) {
    return "";
  }
  const cacheKey = normalizePath(projectPath);
  const now = Date.now();
  const gitDir = resolveGitDir(projectPath);
  const indexPath = gitDir ? path.join(gitDir, "index") : "";
  const gitIndexMtimeMs = indexPath && existsSync(indexPath) ? statSync(indexPath).mtimeMs : 0;
  const cached = projectLastCommitCache.get(cacheKey);
  if (
    cached
    && (now - cached.computedAtMs) < projectLastCommitCacheTtlMs
    && cached.gitIndexMtimeMs === gitIndexMtimeMs
  ) {
    return cached.iso;
  }

  const p = await runWithResultTimeoutAsync("git", ["log", "-1", "--format=%cI", "--", "."], projectPath, 4000);
  const iso = p.status === 0 ? (p.stdout ?? "").trim() : "";
  projectLastCommitCache.set(cacheKey, { iso, computedAtMs: now, gitIndexMtimeMs });
  return iso;
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

function isUnityHubInstalled(): boolean {
  if (process.platform === "win32") {
    const pf = process.env.ProgramFiles ?? "C:\\Program Files";
    const local = process.env.LocalAppData ?? "";
    const candidates = [
      path.join(pf, "Unity Hub", "Unity Hub.exe"),
      path.join(local, "Programs", "Unity Hub", "Unity Hub.exe"),
    ];
    return candidates.some((item) => existsSync(item)) || Boolean(findHubFile("projects-v1.json"));
  }
  if (process.platform === "darwin") {
    return existsSync("/Applications/Unity Hub.app") || Boolean(findHubFile("projects-v1.json"));
  }
  return commandExists("unityhub") || existsSync("/usr/bin/unityhub") || Boolean(findHubFile("projects-v1.json"));
}

function importHubProjectsIntoStore(store: StoreShape): { added: number; hubFound: boolean } {
  let added = 0;
  let hubFound = false;
  const hubProjectsFile = findHubFile("projects-v1.json");
  if (hubProjectsFile && existsSync(hubProjectsFile)) {
    hubFound = true;
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
        added += 1;
        existing.add(norm);
      }
    } catch {
      // Ignore malformed hub cache.
    }
  }
  return { added, hubFound };
}

function bootstrapFromHubOnFirstRun(store: StoreShape): StoreShape {
  if (store.meta.firstRunBootstrapDone) {
    return store;
  }

  importHubProjectsIntoStore(store);

  store.meta.firstRunBootstrapDone = true;
  saveStore(store);
  return store;
}

function syncProjectsFromUnityHub(): { ok: boolean; message: string; added: number } {
  const store = loadStore();
  const { added, hubFound } = importHubProjectsIntoStore(store);
  if (!hubFound) {
    return { ok: false, message: "Unity Hub cache not found on this machine.", added: 0 };
  }
  saveStore(store);
  return {
    ok: true,
    message: added > 0 ? `Imported ${added} project${added === 1 ? "" : "s"} from Unity Hub.` : "No new Unity Hub projects found.",
    added,
  };
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

function runWithResult(cmd: string, args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const p = spawnSync(cmd, args, { cwd, encoding: "utf-8", timeout: 2000 });
  return {
    status: p.status,
    stdout: (p.stdout ?? "").trim(),
    stderr: (p.stderr ?? "").trim(),
  };
}

function runToolWithResult(cmd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const p = spawnSync(cmd, args, { encoding: "utf-8", timeout: 5000 });
  return {
    status: p.status,
    stdout: (p.stdout ?? "").trim(),
    stderr: (p.stderr ?? "").trim(),
  };
}

function runWithResultTimeout(
  cmd: string,
  args: string[],
  cwd: string,
  timeout: number,
): { status: number | null; stdout: string; stderr: string } {
  const p = spawnSync(cmd, args, { cwd, encoding: "utf-8", timeout });
  return {
    status: p.status,
    stdout: (p.stdout ?? "").trim(),
    stderr: (p.stderr ?? "").trim(),
  };
}

function runWithResultTimeoutAsync(
  cmd: string,
  args: string[],
  cwd: string,
  timeout: number,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd, encoding: "utf-8", timeout, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({
            status: 0,
            stdout: (stdout ?? "").trim(),
            stderr: (stderr ?? "").trim(),
          });
          return;
        }
        const code = typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === "number"
          ? ((error as NodeJS.ErrnoException & { code?: number }).code ?? null)
          : null;
        resolve({
          status: code,
          stdout: (stdout ?? "").trim(),
          stderr: (stderr ?? "").trim(),
        });
      },
    );
  });
}

function compactMessage(input: string, fallback: string): string {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^warning:\s+in the working copy/i.test(line));

  const text = (lines.join(" | ") || fallback).replace(/\s+/g, " ").trim();
  if (text.length <= 220) {
    return text;
  }
  return `${text.slice(0, 217)}...`;
}

function getGhToken(): string {
  if (!commandExists("gh")) {
    return "";
  }
  const result = runToolWithResult("gh", ["auth", "token"]);
  if (result.status !== 0) {
    return "";
  }
  return result.stdout.trim();
}

function getGlabToken(): string {
  const glabExe = resolveGlabExecutable();
  if (!glabExe) {
    return "";
  }
  const candidates = [
    ["auth", "status", "--hostname", "gitlab.com", "--show-token"],
    ["auth", "status", "--show-token"],
  ];
  for (const args of candidates) {
    const result = runToolWithResult(glabExe, args);
    if (result.status !== 0) {
      continue;
    }
    const combinedOutput = `${result.stdout}\n${result.stderr}`;
    const line = combinedOutput
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item.toLowerCase().includes("token found:"));
    if (!line) {
      continue;
    }
    const token = line.replace(/^✓\s*Token found:\s*/i, "").replace(/^Token found:\s*/i, "").trim();
    if (token && !token.includes("*")) {
      return token;
    }
  }
  return "";
}

function getGlabStatus(): { installed: boolean; authenticated: boolean; login: string } {
  const glabExe = resolveGlabExecutable();
  if (!glabExe) {
    return { installed: false, authenticated: false, login: "" };
  }
  const result = runToolWithResult(glabExe, ["auth", "status", "--hostname", "gitlab.com"]);
  const combined = `${result.stdout}\n${result.stderr}`;
  const authenticated = result.status === 0 && /logged in to\s+gitlab\.com\s+as\s+/i.test(combined);
  const loginMatch = combined.match(/logged in to\s+gitlab\.com\s+as\s+([^\s(]+)/i);
  return {
    installed: true,
    authenticated,
    login: loginMatch?.[1] ?? "",
  };
}

function getEffectiveGitHubToken(): { token: string; source: "gh" | "none" } {
  const ghToken = getGhToken();
  if (ghToken) {
    return { token: ghToken, source: "gh" };
  }
  return { token: "", source: "none" };
}

async function githubRequest<T>(token: string, endpoint: string): Promise<T> {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "electron-unity-hub",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json() as { message?: string };
      if (body.message) {
        message = body.message;
      }
    } catch {
      // Ignore parse error.
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

async function gitlabRequest<T>(token: string, endpoint: string): Promise<T> {
  const res = await fetch(`https://gitlab.com/api/v4${endpoint}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "electron-unity-hub",
    },
  });

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json() as { message?: string };
      if (body.message) {
        message = body.message;
      }
    } catch {
      // Ignore parse error.
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

function parseUnityVersionFromText(content: string): string {
  const line = content.split(/\r?\n/).find((item) => item.startsWith("m_EditorVersion:"));
  return line ? line.split(":", 2)[1].trim() : "";
}

async function fetchUnityVersionFromRepo(token: string, repo: GitHubRepo): Promise<string> {
  const [owner, name] = repo.full_name.split("/");
  if (!owner || !name) {
    return "";
  }

  const ownerEnc = encodeURIComponent(owner);
  const nameEnc = encodeURIComponent(name);
  const refEnc = encodeURIComponent(repo.default_branch || "HEAD");
  const rootPath = `/repos/${ownerEnc}/${nameEnc}/contents/ProjectSettings/ProjectVersion.txt?ref=${refEnc}`;

  try {
    const root = await githubRequest<{ content?: string; encoding?: string }>(token, rootPath);
    if (root.content && root.encoding === "base64") {
      const text = Buffer.from(root.content, "base64").toString("utf-8");
      return parseUnityVersionFromText(text);
    }
  } catch {
    // Continue with tree search fallback.
  }

  try {
    const tree = await githubRequest<{ tree?: Array<{ path?: string; type?: string }> }>(
      token,
      `/repos/${ownerEnc}/${nameEnc}/git/trees/${refEnc}?recursive=1`,
    );
    const entry = (tree.tree ?? []).find((item) =>
      item.type === "blob"
      && typeof item.path === "string"
      && /(^|\/)ProjectSettings\/ProjectVersion\.txt$/i.test(item.path),
    );
    if (!entry?.path) {
      return "";
    }
    const targetPath = encodeURIComponent(entry.path);
    const file = await githubRequest<{ content?: string; encoding?: string }>(
      token,
      `/repos/${ownerEnc}/${nameEnc}/contents/${targetPath}?ref=${refEnc}`,
    );
    if (file.content && file.encoding === "base64") {
      const text = Buffer.from(file.content, "base64").toString("utf-8");
      return parseUnityVersionFromText(text);
    }
  } catch {
    // Ignore per-repo errors; keep discovery resilient.
  }

  return "";
}

async function fetchGitHubRepos(token: string): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await githubRequest<GitHubRepo[]>(
      token,
      `/user/repos?affiliation=owner,collaborator&sort=updated&per_page=100&page=${page}`,
    );
    repos.push(...batch);
    if (batch.length < 100) {
      break;
    }
  }
  return repos;
}

async function fetchGitLabRepos(token: string): Promise<GitLabRepo[]> {
  const repos: GitLabRepo[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await gitlabRequest<GitLabRepo[]>(
      token,
      `/projects?membership=true&owned=true&simple=true&order_by=last_activity_at&sort=desc&per_page=100&page=${page}`,
    );
    repos.push(...batch);
    if (batch.length < 100) {
      break;
    }
  }
  return repos;
}

async function fetchGitHubRepoMeta(
  token: string,
  repoFullName: string,
): Promise<{ pushedAtIso: string; repoSizeBytes: number } | null> {
  const [owner, name] = repoFullName.split("/");
  if (!owner || !name) {
    return null;
  }
  const ownerEnc = encodeURIComponent(owner);
  const nameEnc = encodeURIComponent(name);
  try {
    const repo = await githubRequest<GitHubRepo>(token, `/repos/${ownerEnc}/${nameEnc}`);
    return {
      pushedAtIso: repo.pushed_at ?? "",
      repoSizeBytes: Math.max(0, Number(repo.size ?? 0)) * 1024,
    };
  } catch {
    return null;
  }
}

async function mapWithConcurrency<TInput, TOutput>(
  input: TInput[],
  worker: (item: TInput) => Promise<TOutput>,
  concurrency = 6,
): Promise<TOutput[]> {
  const results: TOutput[] = new Array(input.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < input.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(input[current]);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, input.length || 1)) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

function dedupeCloudProjects(projects: ProjectEntry[]): ProjectEntry[] {
  const seen = new Set<string>();
  const deduped: ProjectEntry[] = [];
  for (const project of projects) {
    const key = `${(project.cloudRepo ?? "").toLowerCase()}|${(project.cloneUrl ?? "").toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(project);
  }
  return deduped;
}

async function discoverUnityCloudProjects(token: string): Promise<ProjectEntry[]> {
  const repos = await fetchGitHubRepos(token);
  const mapped = await mapWithConcurrency(
    repos,
    async (repo) => {
      const unityVersion = await fetchUnityVersionFromRepo(token, repo);
      if (!unityVersion) {
        return null;
      }
      return {
        id: `github:${repo.full_name.toLowerCase()}`,
        nickname: repo.name,
        name: repo.name,
        path: "",
        unityVersion,
        unityExe: "",
        lastOpenedIso: repo.pushed_at ?? "",
        cloudRepo: repo.full_name,
        cloneUrl: repo.clone_url,
        repoSizeBytes: Math.max(0, Number(repo.size ?? 0)) * 1024,
      } as ProjectEntry;
    },
    6,
  );
  return dedupeCloudProjects(mapped.filter((item): item is ProjectEntry => item !== null));
}

async function discoverUnityGitLabCloudProjects(token: string): Promise<ProjectEntry[]> {
  const repos = await fetchGitLabRepos(token);
  const mapped = await mapWithConcurrency(
    repos,
    async (repo) => {
      const unityVersion = await fetchUnityVersionFromGitLabRepo(token, repo);
      if (!unityVersion) {
        return null;
      }
      return {
        id: `gitlab:${repo.path_with_namespace.toLowerCase()}`,
        nickname: repo.name,
        name: repo.name,
        path: "",
        unityVersion,
        unityExe: "",
        lastOpenedIso: repo.last_activity_at ?? "",
        cloudRepo: repo.path_with_namespace,
        cloneUrl: repo.http_url_to_repo,
        repoSizeBytes: Math.max(0, Number(repo.statistics?.repository_size ?? 0)),
      } as ProjectEntry;
    },
    6,
  );
  return dedupeCloudProjects(mapped.filter((item): item is ProjectEntry => item !== null));
}

async function getGitHubAuthStatus(): Promise<GitHubAuthStatus> {
  const ghInstalled = commandExists("gh");
  const { token, source } = getEffectiveGitHubToken();
  const installHint = getGhInstallHint();
  const installUrl = "https://cli.github.com/";
  if (!token) {
    return {
      ghInstalled,
      ghAuthenticated: false,
      connected: false,
      login: "",
      source: "none",
      installHint,
      installUrl,
      message: ghInstalled ? "Not connected" : "GitHub CLI not installed",
    };
  }
  try {
    const user = await githubRequest<GitHubUser>(token, "/user");
    return {
      ghInstalled,
      ghAuthenticated: source === "gh",
      connected: true,
      login: user.login ?? "",
      source,
      installHint,
      installUrl,
      message: "Connected via GitHub CLI",
    };
  } catch (error) {
    return {
      ghInstalled,
      ghAuthenticated: false,
      connected: false,
      login: "",
      source: "none",
      installHint,
      installUrl,
      message: `GitHub auth invalid: ${String(error)}`,
    };
  }
}

function emptyVcsStatus(kind = "None", branchOrStream = "", state = "not detected"): VcsStatus {
  return {
    kind,
    branchOrStream,
    state,
    localChangesCount: 0,
    incomingCount: 0,
    outgoingCount: 0,
    conflictCount: 0,
    infoMessage: "",
  };
}

function isGitRepo(projectPath: string): boolean {
  if (existsSync(path.join(projectPath, ".git"))) {
    return true;
  }
  return run("git", ["rev-parse", "--is-inside-work-tree"], projectPath) === "true";
}

async function gitStatus(projectPath: string): Promise<VcsStatus> {
  const statusResult = await runWithResultTimeoutAsync("git", ["status", "--porcelain=v1", "--branch"], projectPath, 5000);
  if (statusResult.status !== 0) {
    const err = statusResult.stderr.toLowerCase();
    const blocked = err.includes("dubious ownership");
    return {
      kind: "Git",
      branchOrStream: blocked ? "safe.directory required" : "unavailable",
      state: blocked ? "unsafe ownership" : "error",
      localChangesCount: 0,
      incomingCount: 0,
      outgoingCount: 0,
      conflictCount: 0,
      infoMessage: blocked
        ? `Git blocked by safe.directory. Run: git config --global --add safe.directory ${projectPath.replace(/\\/g, "/")}`
        : statusResult.stderr || "Git status unavailable",
    };
  }

  const statusWithBranch = statusResult.stdout;
  const statusLines = statusWithBranch.split(/\r?\n/).filter((line) => line.trim().length > 0 && !line.startsWith("##"));
  const localChangesCount = statusLines.length;
  const conflictCount = statusLines.reduce((acc, line) => {
    const xy = line.slice(0, 2);
    const conflicted = xy.includes("U") || xy === "AA" || xy === "DD";
    return acc + (conflicted ? 1 : 0);
  }, 0);

  let incomingCount = 0;
  let outgoingCount = 0;
  const [aheadBehindResult, branchResult] = await Promise.all([
    runWithResultTimeoutAsync("git", ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], projectPath, 4000),
    runWithResultTimeoutAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], projectPath, 4000),
  ]);
  const aheadBehind = aheadBehindResult.status === 0 ? aheadBehindResult.stdout : "";
  if (aheadBehind) {
    const parts = aheadBehind.split(/\s+/).map((value) => Number.parseInt(value, 10));
    if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      incomingCount = parts[0];
      outgoingCount = parts[1];
    }
  }

  const branch = (branchResult.status === 0 ? branchResult.stdout : "") || "unknown";
  const state = conflictCount > 0 ? "conflict" : localChangesCount > 0 ? "dirty" : "clean";
  return {
    kind: "Git",
    branchOrStream: branch,
    state,
    localChangesCount,
    incomingCount,
    outgoingCount,
    conflictCount,
    infoMessage: "",
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
  const opened = run("p4", ["-d", projectPath, "opened"], projectPath);
  const localChangesCount = opened
    ? opened.split(/\r?\n/).filter((line) => line.trim().length > 0).length
    : 0;

  const syncPreview = run("p4", ["-d", projectPath, "sync", "-n"], projectPath);
  const incomingCount = syncPreview && !syncPreview.toLowerCase().includes("up-to-date")
    ? syncPreview.split(/\r?\n/).filter((line) => line.trim().length > 0).length
    : 0;

  const resolvePreview = run("p4", ["-d", projectPath, "resolve", "-n"], projectPath);
  const conflictCount = resolvePreview
    ? resolvePreview.split(/\r?\n/).filter((line) => line.trim().length > 0).length
    : 0;
  const state = conflictCount > 0 ? "conflict" : localChangesCount > 0 ? "dirty" : "clean";

  return {
    kind: "Perforce",
    branchOrStream: streamLine ? streamLine.replace("Stream:", "").trim() : "workspace",
    state,
    localChangesCount,
    incomingCount,
    outgoingCount: 0,
    conflictCount,
    infoMessage: "",
  };
}

function isSvnRepo(projectPath: string): boolean {
  if (existsSync(path.join(projectPath, ".svn"))) {
    return true;
  }
  return run("svn", ["info"], projectPath).length > 0;
}

function svnStatus(projectPath: string): VcsStatus {
  const url = run("svn", ["info", "--show-item", "url"], projectPath);
  const localStatus = run("svn", ["status"], projectPath);
  const localLines = localStatus
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const localChangesCount = localLines.length;
  const conflictCount = localLines.filter((line) => line.startsWith("C")).length;

  const remoteStatus = run("svn", ["status", "-u"], projectPath);
  const incomingCount = remoteStatus
    .split(/\r?\n/)
    .filter((line) => line.length > 8 && line[8] === "*")
    .length;

  const state = conflictCount > 0 ? "conflict" : localChangesCount > 0 ? "dirty" : "clean";
  return {
    kind: "SVN",
    branchOrStream: url || "working copy",
    state,
    localChangesCount,
    incomingCount,
    outgoingCount: 0,
    conflictCount,
    infoMessage: "",
  };
}

function plasticWorkspaceKind(projectPath: string): "Plastic" | "Unity Version Control" {
  if (existsSync(path.join(projectPath, ".unityvcs"))) {
    return "Unity Version Control";
  }
  return "Plastic";
}

function isPlasticRepo(projectPath: string): boolean {
  if (existsSync(path.join(projectPath, ".plastic")) || existsSync(path.join(projectPath, ".unityvcs"))) {
    return true;
  }
  if (!commandExists("cm")) {
    return false;
  }
  return run("cm", ["status", "--noheaders"], projectPath).length > 0;
}

function plasticStatus(projectPath: string): VcsStatus {
  const kind = plasticWorkspaceKind(projectPath);
  const statusOutput = run("cm", ["status", "--noheaders"], projectPath);
  const statusLines = statusOutput
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const localChangesCount = statusLines.length;

  const conflictOutput = run("cm", ["resolve", "--pending"], projectPath);
  const conflictCount = conflictOutput
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0 && !line.toLowerCase().includes("no pending"))
    .length;

  // Lightweight incoming preview; fallback to 0 if unavailable.
  const incomingOutput = run("cm", ["incoming", "--format={changesetid}"], projectPath);
  const incomingCount = incomingOutput
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .length;

  const branch =
    run("cm", ["status", "--header"], projectPath)
      .split(/\r?\n/)
      .find((line) => /branch|selector|workspace/i.test(line))
      ?.trim() ?? "workspace";
  const state = conflictCount > 0 ? "conflict" : localChangesCount > 0 ? "dirty" : "clean";
  return {
    kind,
    branchOrStream: branch,
    state,
    localChangesCount,
    incomingCount,
    outgoingCount: 0,
    conflictCount,
    infoMessage: "",
  };
}

async function getVcsStatus(projectPath: string): Promise<VcsStatus> {
  if (!existsSync(projectPath)) {
    return emptyVcsStatus("None", "", "missing path");
  }
  if (isGitRepo(projectPath)) {
    return await gitStatus(projectPath);
  }
  if (isPerforce(projectPath)) {
    return perforceStatus(projectPath);
  }
  if (isSvnRepo(projectPath)) {
    return svnStatus(projectPath);
  }
  if (isPlasticRepo(projectPath)) {
    return plasticStatus(projectPath);
  }
  return emptyVcsStatus("None", "", "not detected");
}

async function gitCommitAndPush(projectPath: string): Promise<{ ok: boolean; message: string; conflict?: boolean }> {
  if (!projectPath.trim() || !existsSync(projectPath)) {
    return { ok: false, message: "Project path is missing." };
  }
  if (!isGitRepo(projectPath)) {
    return { ok: false, message: "Commit & Push supports git projects only." };
  }

  const addRes = await runWithResultTimeoutAsync("git", ["add", "-A"], projectPath, 60_000);
  if (addRes.status !== 0) {
    const combined = `${addRes.stderr}\n${addRes.stdout}`;
    return { ok: false, message: compactMessage(combined, "Failed to stage changes. Close Unity and try again.") };
  }

  const diffRes = await runWithResultTimeoutAsync("git", ["diff", "--cached", "--quiet"], projectPath, 10_000);
  if (diffRes.status === 0) {
    return { ok: true, message: "Nothing to commit." };
  }

  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
  const commitMessage = `Update from Electron Unity Hub (${stamp} UTC)`;
  const commitRes = await runWithResultTimeoutAsync("git", ["commit", "-m", commitMessage], projectPath, 60_000);
  if (commitRes.status !== 0) {
    const combined = `${commitRes.stderr}\n${commitRes.stdout}`;
    return { ok: false, message: compactMessage(combined, "Commit failed.") };
  }

  const pushRes = await runWithResultTimeoutAsync("git", ["push"], projectPath, 90_000);
  if (pushRes.status === 0) {
    return { ok: true, message: "Committed and pushed changes." };
  }

  const pushErr = `${pushRes.stderr}\n${pushRes.stdout}`.toLowerCase();
  const outOfDate = pushErr.includes("non-fast-forward")
    || pushErr.includes("fetch first")
    || pushErr.includes("rejected");
  if (outOfDate) {
    const pullRebaseRes = await runWithResultTimeoutAsync("git", ["pull", "--rebase", "--autostash"], projectPath, 120_000);
    if (pullRebaseRes.status !== 0) {
      const rebaseOutput = `${pullRebaseRes.stderr}\n${pullRebaseRes.stdout}`.toLowerCase();
      const hasConflict = rebaseOutput.includes("conflict") || rebaseOutput.includes("could not apply");
      if (hasConflict) {
        return {
          ok: false,
          message: "Push blocked: remote has newer changes and auto-rebase found conflicts. Resolve conflicts and push again.",
          conflict: true,
        };
      }
      return { ok: false, message: compactMessage(`${pullRebaseRes.stderr}\n${pullRebaseRes.stdout}`, "Pull/rebase failed before push.") };
    }

    const pushAfterRebaseRes = await runWithResultTimeoutAsync("git", ["push"], projectPath, 90_000);
    if (pushAfterRebaseRes.status === 0) {
      return { ok: true, message: "Committed, synced latest changes, and pushed." };
    }
    return { ok: false, message: compactMessage(`${pushAfterRebaseRes.stderr}\n${pushAfterRebaseRes.stdout}`, "Push failed after sync.") };
  }

  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], projectPath) || "";
  if (branch && branch !== "HEAD") {
    const upstreamPush = await runWithResultTimeoutAsync("git", ["push", "-u", "origin", branch], projectPath, 90_000);
    if (upstreamPush.status === 0) {
      return { ok: true, message: "Committed and pushed changes." };
    }
      return { ok: false, message: compactMessage(`${upstreamPush.stderr}\n${pushRes.stderr}`, "Push failed.") };
  }

  return { ok: false, message: compactMessage(`${pushRes.stderr}\n${pushRes.stdout}`, "Push failed. Branch has no upstream.") };
}

async function gitPull(projectPath: string): Promise<{ ok: boolean; message: string }> {
  if (!projectPath.trim() || !existsSync(projectPath)) {
    return { ok: false, message: "Project path is missing." };
  }
  if (!isGitRepo(projectPath)) {
    return { ok: false, message: "Pull supports git projects only." };
  }

  const fetchRes = await runWithResultTimeoutAsync("git", ["fetch", "--prune"], projectPath, 90_000);
  if (fetchRes.status !== 0) {
    return { ok: false, message: compactMessage(`${fetchRes.stderr}\n${fetchRes.stdout}`, "Fetch failed.") };
  }

  const pullRes = await runWithResultTimeoutAsync("git", ["pull", "--ff-only"], projectPath, 90_000);
  if (pullRes.status !== 0) {
    return {
      ok: false,
      message: compactMessage(`${pullRes.stderr}\n${pullRes.stdout}`, "Pull failed. Resolve divergence manually."),
    };
  }
  if ((pullRes.stdout || "").toLowerCase().includes("already up to date")) {
    return { ok: true, message: "Already up to date." };
  }
  return { ok: true, message: "Pulled latest changes." };
}

function projectIsOpen(projectPath: string): boolean {
  return existsSync(path.join(projectPath, "Temp", "UnityLockfile"));
}

type FocusResult = {
  ok: boolean;
  reason?: string;
};

function commandExists(cmd: string): boolean {
  const checker = process.platform === "win32" ? "where" : "which";
  const p = spawnSync(checker, [cmd], { encoding: "utf-8", timeout: 2000 });
  return p.status === 0;
}

function resolveGlabExecutable(): string {
  if (process.platform === "win32") {
    const whereResult = runToolWithResult("where", ["glab"]);
    if (whereResult.status === 0 && whereResult.stdout.trim()) {
      return whereResult.stdout.split(/\r?\n/)[0].trim();
    }
    const local = process.env.LocalAppData ?? "";
    const candidates = [
      path.join(local, "Programs", "glab", "glab.exe"),
      path.join(local, "Programs", "GitLab CLI", "glab.exe"),
      path.join("C:\\Program Files", "glab", "glab.exe"),
      path.join("C:\\Program Files", "GitLab CLI", "glab.exe"),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return "";
  }

  if (commandExists("glab")) {
    return "glab";
  }
  const unixCandidates = ["/usr/local/bin/glab", "/usr/bin/glab", "/opt/homebrew/bin/glab"];
  for (const candidate of unixCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return "";
}

function startGhAuthLogin(): { ok: boolean; message: string } {
  if (!commandExists("gh")) {
    return { ok: false, message: "GitHub CLI is not installed. Install GH CLI first." };
  }

  try {
    if (process.platform === "win32") {
      const psCommand = "gh auth login";
      spawn("cmd.exe", ["/c", "start", "", "powershell.exe", "-NoExit", "-Command", psCommand], {
        detached: true,
        windowsHide: false,
        stdio: "ignore",
      }).unref();
      return { ok: true, message: "Opened and focused terminal for `gh auth login`." };
    }

    if (process.platform === "darwin") {
      const script = "tell application \"Terminal\" to activate\ntell application \"Terminal\" to do script \"gh auth login\"";
      spawn("osascript", ["-e", script], {
        detached: true,
        stdio: "ignore",
      }).unref();
      return { ok: true, message: "Opened and focused Terminal for `gh auth login`." };
    }

    const candidates: Array<{ cmd: string; args: string[] }> = [
      { cmd: "x-terminal-emulator", args: ["-e", "bash -lc 'gh auth login; exec bash'"] },
      { cmd: "gnome-terminal", args: ["--", "bash", "-lc", "gh auth login; exec bash"] },
      { cmd: "konsole", args: ["-e", "bash", "-lc", "gh auth login; exec bash"] },
      { cmd: "xterm", args: ["-e", "bash -lc 'gh auth login; exec bash'"] },
    ];
    for (const item of candidates) {
      if (!commandExists(item.cmd)) {
        continue;
      }
      spawn(item.cmd, item.args, {
        detached: true,
        stdio: "ignore",
      }).unref();
      return { ok: true, message: "Opened terminal and started `gh auth login`." };
    }
    return { ok: false, message: "No terminal app found. Run `gh auth login` manually." };
  } catch (error) {
    return { ok: false, message: `Failed to start GH auth: ${String(error)}` };
  }
}

async function getGitLabAuthStatus(): Promise<{
  glabInstalled: boolean;
  glabAuthenticated: boolean;
  connected: boolean;
  login: string;
  installHint: string;
  installUrl: string;
  message: string;
}> {
  const glabStatus = getGlabStatus();
  const glabInstalled = glabStatus.installed;
  const installHint = getGlabInstallHint();
  const installUrl = "https://gitlab.com/gitlab-org/cli";
  if (!glabStatus.authenticated) {
    return {
      glabInstalled,
      glabAuthenticated: false,
      connected: false,
      login: glabStatus.login,
      installHint,
      installUrl,
      message: glabInstalled ? "Not connected" : "GitLab CLI not installed",
    };
  }
  return {
    glabInstalled,
    glabAuthenticated: true,
    connected: true,
    login: glabStatus.login,
    installHint,
    installUrl,
    message: "Connected via GitLab CLI",
  };
}

async function fetchGitLabRepoMeta(
  token: string,
  repoPathWithNamespace: string,
): Promise<{ pushedAtIso: string; repoSizeBytes: number } | null> {
  if (!repoPathWithNamespace.trim()) {
    return null;
  }
  const repoEnc = encodeURIComponent(repoPathWithNamespace);
  try {
    const repo = await gitlabRequest<GitLabRepo>(token, `/projects/${repoEnc}?statistics=true`);
    return {
      pushedAtIso: repo.last_activity_at ?? "",
      repoSizeBytes: Math.max(0, Number(repo.statistics?.repository_size ?? 0)),
    };
  } catch {
    return null;
  }
}

async function fetchUnityVersionFromGitLabRepo(token: string, repo: GitLabRepo): Promise<string> {
  const ref = encodeURIComponent(repo.default_branch || "main");
  const filePath = encodeURIComponent("ProjectSettings/ProjectVersion.txt");
  try {
    const res = await fetch(
      `https://gitlab.com/api/v4/projects/${repo.id}/repository/files/${filePath}/raw?ref=${ref}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "electron-unity-hub",
        },
      },
    );
    if (!res.ok) {
      return "";
    }
    const text = await res.text();
    return parseUnityVersionFromText(text);
  } catch {
    return "";
  }
}

function startGlabAuthLogin(): { ok: boolean; message: string } {
  const glabExe = resolveGlabExecutable();
  if (!glabExe) {
    return { ok: false, message: "GitLab CLI is not installed. Install GitLab CLI first." };
  }
  const glabCmd = process.platform === "win32" ? `"${glabExe}"` : glabExe;

  try {
    if (process.platform === "win32") {
      const escaped = glabExe.replace(/'/g, "''");
      const psCommand = `& '${escaped}' auth login`;
      spawn("cmd.exe", ["/c", "start", "", "powershell.exe", "-NoExit", "-Command", psCommand], {
        detached: true,
        windowsHide: false,
        stdio: "ignore",
      }).unref();
      return { ok: true, message: "Opened and focused terminal for `glab auth login`." };
    }
    if (process.platform === "darwin") {
      const script = `tell application "Terminal" to activate\ntell application "Terminal" to do script "${glabCmd} auth login"`;
      spawn("osascript", ["-e", script], { detached: true, stdio: "ignore" }).unref();
      return { ok: true, message: "Opened and focused Terminal for `glab auth login`." };
    }
    const terminals = [
      { cmd: "x-terminal-emulator", args: ["-e", `bash -lc '${glabCmd} auth login; exec bash'`] },
      { cmd: "gnome-terminal", args: ["--", "bash", "-lc", `${glabCmd} auth login; exec bash`] },
      { cmd: "konsole", args: ["-e", "bash", "-lc", `${glabCmd} auth login; exec bash`] },
      { cmd: "xterm", args: ["-e", `bash -lc '${glabCmd} auth login; exec bash'`] },
    ];
    for (const terminal of terminals) {
      if (!commandExists(terminal.cmd)) {
        continue;
      }
      spawn(terminal.cmd, terminal.args, { detached: true, stdio: "ignore" }).unref();
      return { ok: true, message: "Opened terminal and started `glab auth login`." };
    }
    return { ok: false, message: "No terminal app found. Run `glab auth login` manually." };
  } catch (error) {
    return { ok: false, message: `Failed to start GitLab auth: ${String(error)}` };
  }
}

function startGlabInstall(): { ok: boolean; message: string } {
  const linuxInstallCmd = "if command -v apt-get >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y glab; elif command -v dnf >/dev/null 2>&1; then sudo dnf install -y glab; elif command -v pacman >/dev/null 2>&1; then sudo pacman -S --noconfirm glab; else echo 'No supported package manager detected. Install from https://gitlab.com/gitlab-org/cli'; fi";
  try {
    if (process.platform === "win32") {
      const script = [
        "$ws = New-Object -ComObject WScript.Shell",
        "$proc = Start-Process cmd.exe -ArgumentList '/k winget install --id GLab.GLab -e --source winget --accept-source-agreements --accept-package-agreements' -PassThru",
        "Start-Sleep -Milliseconds 250",
        "$null = $ws.AppActivate($proc.Id)",
      ].join("; ");
      spawn("powershell.exe", ["-NoProfile", "-Command", script], {
        detached: true,
        stdio: "ignore",
      }).unref();
      return { ok: true, message: "Opened terminal and started GitLab CLI install via winget." };
    }
    if (process.platform === "darwin") {
      const script = "tell application \"Terminal\" to activate\ntell application \"Terminal\" to do script \"brew install glab\"";
      spawn("osascript", ["-e", script], { detached: true, stdio: "ignore" }).unref();
      return { ok: true, message: "Opened Terminal and started GitLab CLI install via Homebrew." };
    }
    const terminals = [
      { cmd: "x-terminal-emulator", args: ["-e", `bash -lc '${linuxInstallCmd}; exec bash'`] },
      { cmd: "gnome-terminal", args: ["--", "bash", "-lc", `${linuxInstallCmd}; exec bash`] },
      { cmd: "konsole", args: ["-e", "bash", "-lc", `${linuxInstallCmd}; exec bash`] },
      { cmd: "xterm", args: ["-e", `bash -lc '${linuxInstallCmd}; exec bash'`] },
    ];
    for (const terminal of terminals) {
      if (!commandExists(terminal.cmd)) {
        continue;
      }
      spawn(terminal.cmd, terminal.args, { detached: true, stdio: "ignore" }).unref();
      return { ok: true, message: "Opened terminal and started GitLab CLI install." };
    }
    return { ok: false, message: "No terminal app found. Install GitLab CLI manually from https://gitlab.com/gitlab-org/cli" };
  } catch (error) {
    return { ok: false, message: `Failed to start GitLab CLI install: ${String(error)}` };
  }
}

async function getDependencyStatus(): Promise<{
  gitInstalled: boolean;
  ghInstalled: boolean;
  ghAuthenticated: boolean;
  ghLogin: string;
  glabInstalled: boolean;
  glabAuthenticated: boolean;
  glabLogin: string;
  hubInstalled: boolean;
}> {
  const [gh, glab] = await Promise.all([getGitHubAuthStatus(), getGitLabAuthStatus()]);
  return {
    gitInstalled: commandExists("git"),
    ghInstalled: gh.ghInstalled,
    ghAuthenticated: gh.ghAuthenticated,
    ghLogin: gh.login,
    glabInstalled: glab.glabInstalled,
    glabAuthenticated: glab.glabAuthenticated,
    glabLogin: glab.login,
    hubInstalled: isUnityHubInstalled(),
  };
}

function projectTitleCandidates(project: ProjectEntry): string[] {
  const basename = path.basename(project.path);
  return [project.nickname, project.name, basename]
    .map((value) => value.trim())
    .filter((value, index, arr) => value.length > 0 && arr.indexOf(value) === index);
}

function focusUnityWindowWindows(project: ProjectEntry): FocusResult {
  const candidates = projectTitleCandidates(project);
  if (candidates.length === 0) {
    return { ok: false, reason: "no project title candidates" };
  }

  const escaped = candidates.map((value) => `'${value.replace(/'/g, "''")}'`).join(", ");

  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Win32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$targets = @(${escaped})
$script:matched = $false

[Win32]::EnumWindows({
  param($hWnd, $lParam)
  if (-not [Win32]::IsWindowVisible($hWnd)) { return $true }
  $titleBuilder = New-Object System.Text.StringBuilder 512
  [void][Win32]::GetWindowText($hWnd, $titleBuilder, $titleBuilder.Capacity)
  $title = $titleBuilder.ToString()
  if ([string]::IsNullOrWhiteSpace($title)) { return $true }

  $windowPid = 0
  [void][Win32]::GetWindowThreadProcessId($hWnd, [ref]$windowPid)
  if ($windowPid -le 0) { return $true }

  try {
    $proc = [System.Diagnostics.Process]::GetProcessById([int]$windowPid)
  } catch {
    return $true
  }

  if ($proc.ProcessName -ne 'Unity') { return $true }

  foreach ($target in $targets) {
    if ($title -like ('*' + $target + '*')) {
      [void][Win32]::ShowWindow($hWnd, 9)
      [void][Win32]::SetForegroundWindow($hWnd)
      $script:matched = $true
      return $false
    }
  }

  return $true
}, [IntPtr]::Zero) | Out-Null

if ($script:matched) { exit 0 } else { exit 1 }
`;
  const p = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf-8", timeout: 3000 });
  return p.status === 0
    ? { ok: true }
    : { ok: false, reason: "no matching Unity window title found" };
}

function focusUnityWindowMac(project: ProjectEntry): FocusResult {
  if (!commandExists("osascript")) {
    return { ok: false, reason: "missing dependency: osascript" };
  }

  const candidates = projectTitleCandidates(project);
  if (candidates.length === 0) {
    return { ok: false, reason: "no project title candidates" };
  }

  const escaped = candidates.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(", ");
  const script = `
set targets to {${escaped}}
tell application "System Events"
  if not (exists process "Unity") then return "missing"
  tell process "Unity"
    set frontmost to true
    repeat with w in windows
      set windowName to (name of w) as text
      repeat with t in targets
        if windowName contains t then
          try
            perform action "AXRaise" of w
          end try
          set frontmost to true
          return "ok"
        end if
      end repeat
    end repeat
  end tell
end tell
return "nomatch"
`;
  const p = spawnSync("osascript", ["-e", script], { encoding: "utf-8", timeout: 4000 });
  const out = (p.stdout ?? "").trim().toLowerCase();
  if (p.status === 0 && out.includes("ok")) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: "focus failed on macOS. Ensure Accessibility permission is granted to the app/terminal in System Settings > Privacy & Security > Accessibility.",
  };
}

function focusUnityWindowLinux(project: ProjectEntry): FocusResult {
  const candidates = projectTitleCandidates(project);
  if (candidates.length === 0) {
    return { ok: false, reason: "no project title candidates" };
  }

  const hasWmctrl = commandExists("wmctrl");
  const hasXdotool = commandExists("xdotool");
  if (!hasWmctrl && !hasXdotool) {
    return {
      ok: false,
      reason: "missing dependency: install wmctrl or xdotool (Ubuntu/Debian: sudo apt install wmctrl xdotool, Fedora: sudo dnf install wmctrl xdotool, Arch: sudo pacman -S wmctrl xdotool).",
    };
  }

  if (hasWmctrl) {
    const list = run("wmctrl", ["-l"], project.path);
    const lines = list.split(/\r?\n/).filter((line) => line.trim().length > 0);
    for (const line of lines) {
      const id = line.split(/\s+/)[0];
      const lower = line.toLowerCase();
      if (!lower.includes("unity")) {
        continue;
      }
      if (!candidates.some((target) => lower.includes(target.toLowerCase()))) {
        continue;
      }
      const activate = spawnSync("wmctrl", ["-ia", id], { encoding: "utf-8", timeout: 3000 });
      if (activate.status === 0) {
        return { ok: true };
      }
    }
  }

  if (hasXdotool) {
    for (const target of candidates) {
      const activate = spawnSync("xdotool", ["search", "--name", target, "windowactivate"], {
        encoding: "utf-8",
        timeout: 3000,
      });
      if (activate.status === 0) {
        return { ok: true };
      }
    }
  }

  return { ok: false, reason: "no matching Unity window title found" };
}

function focusUnityWindow(project: ProjectEntry): FocusResult {
  if (process.platform === "win32") {
    return focusUnityWindowWindows(project);
  }
  if (process.platform === "darwin") {
    return focusUnityWindowMac(project);
  }
  if (process.platform === "linux") {
    return focusUnityWindowLinux(project);
  }
  return { ok: false, reason: "platform not supported for window focusing" };
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

  if (projectIsOpen(project.path)) {
    const focus = focusUnityWindow(project);
    if (focus.ok) {
      return {
        ok: true,
        message: "Project already open. Focused existing Unity window.",
        focused: true,
        resolvedUnityExe: resolvedExe,
      };
    }
    // Lockfile can be stale; proceed with launch if focus fails.
    const reason = focus.reason ? ` ${focus.reason}` : "";
    try {
      if (!resolvedExe || !existsSync(resolvedExe)) {
        return {
          ok: false,
          message: `Project appears open, but focus failed.${reason} Unity executable is not set or does not exist.`.trim(),
          focused: false,
          resolvedUnityExe: resolvedExe,
        };
      }
      spawn(resolvedExe, ["-projectPath", project.path], { detached: true, stdio: "ignore" }).unref();
      return {
        ok: true,
        message: `Project appears open, but focus failed.${reason} Attempting launch.`.trim(),
        focused: false,
        resolvedUnityExe: resolvedExe,
      };
    } catch (error) {
      return {
        ok: false,
        message: `Project appears open, but focus failed.${reason} Failed to launch: ${String(error)}`.trim(),
        focused: false,
        resolvedUnityExe: resolvedExe,
      };
    }
  }

  if (!resolvedExe || !existsSync(resolvedExe)) {
    return { ok: false, message: "Unity executable is not set or does not exist." };
  }

  try {
    spawn(resolvedExe, ["-projectPath", project.path], { detached: true, stdio: "ignore" }).unref();
    return {
      ok: true,
      message: "Launched Unity project.",
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

function browseToPath(targetPath: string): { ok: boolean; message: string } {
  const value = targetPath.trim();
  if (!value) {
    return { ok: false, message: "Path is required." };
  }
  if (!existsSync(value)) {
    return { ok: false, message: "Path does not exist." };
  }

  try {
    const info = statSync(value);
    if (info.isDirectory()) {
      void shell.openPath(value);
      return { ok: true, message: "Opened folder in file explorer." };
    }
    shell.showItemInFolder(value);
    return { ok: true, message: "Revealed item in file explorer." };
  } catch (error) {
    return { ok: false, message: `Failed to browse path: ${String(error)}` };
  }
}

async function cloneRepository(repoUrl: string, targetDir: string, branch: string): Promise<{ ok: boolean; message: string }> {
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

  return await new Promise((resolve) => {
    const child = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        child.kill();
      } catch {
        // Ignore process termination errors.
      }
      resolve({ ok: false, message: "Clone timed out after 2 minutes." });
    }, 120_000);

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk ?? "");
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({ ok: false, message: `Failed to run git clone: ${String(error)}` });
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ ok: true, message: "Repository cloned." });
        return;
      }
      resolve({ ok: false, message: stderr.trim() || "Failed to clone repository." });
    });
  });
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
  if (!(project.cloudRepo ?? "").trim() && project.path.trim()) {
    project.cloudRepo = inferCloudRepoFromProjectPath(project.path);
  }

  const normalizedProjectPath = project.path.trim() ? normalizePath(project.path) : "";
  const idx = store.projects.findIndex((x) => {
    if (x.id === project.id) {
      return true;
    }
    if (!normalizedProjectPath || !x.path.trim()) {
      return false;
    }
    return normalizePath(x.path) === normalizedProjectPath;
  });
  if (idx >= 0) {
    store.projects[idx] = project;
  } else {
    store.projects.push(project);
  }
  store.projects = dedupeLocalProjects(store.projects);
  saveStore(store);
  return store.projects;
}

function deleteProject(id: string): ProjectEntry[] {
  const store = loadStore();
  store.projects = store.projects.filter((x) => x.id !== id);
  saveStore(store);
  return store.projects;
}

function normalizeRemoteUrlForBrowser(input: string): string {
  const value = input.trim();
  if (!value) {
    return "";
  }
  if (/^https?:\/\//i.test(value)) {
    return value.replace(/\.git$/i, "");
  }
  const sshScp = value.match(/^git@([^:]+):(.+)$/i);
  if (sshScp) {
    const host = sshScp[1];
    const repoPath = sshScp[2].replace(/\.git$/i, "");
    return `https://${host}/${repoPath}`;
  }
  const sshUrl = value.match(/^ssh:\/\/git@([^/]+)\/(.+)$/i);
  if (sshUrl) {
    const host = sshUrl[1];
    const repoPath = sshUrl[2].replace(/\.git$/i, "");
    return `https://${host}/${repoPath}`;
  }
  return value;
}

function getProjectRemoteUrl(projectPath: string): string {
  if (!projectPath.trim() || !existsSync(projectPath) || !isGitRepo(projectPath)) {
    return "";
  }
  const remote = run("git", ["config", "--get", "remote.origin.url"], projectPath);
  return normalizeRemoteUrlForBrowser(remote);
}

function inferCloudRepoFromProjectPath(projectPath: string): string {
  if (!projectPath.trim() || !existsSync(projectPath) || !isGitRepo(projectPath)) {
    return "";
  }
  const remote = run("git", ["config", "--get", "remote.origin.url"], projectPath);
  return parseGitHubRepoKeyFromUrl(remote);
}

function dedupeLocalProjects(projects: ProjectEntry[]): ProjectEntry[] {
  const seen = new Set<string>();
  const deduped: ProjectEntry[] = [];
  for (const project of projects) {
    const pathKey = project.path.trim() ? `path:${normalizePath(project.path)}` : "";
    const cloudKey = (project.cloudRepo ?? "").trim() ? `cloud:${(project.cloudRepo ?? "").trim().toLowerCase()}` : "";
    const cloneKey = (project.cloneUrl ?? "").trim() ? `clone:${normalizeUrlKey(project.cloneUrl ?? "")}` : "";
    const key = pathKey || cloudKey || cloneKey || `id:${project.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(project);
  }
  return deduped;
}

function getNormalizedLocalProjects(): ProjectEntry[] {
  const store = loadStore();
  let changed = false;
  const normalized = dedupeLocalProjects(store.projects).map((project) => {
    let next = project;
    if (!(project.cloudRepo ?? "").trim() && project.path.trim()) {
      const inferred = inferCloudRepoFromProjectPath(project.path);
      if (inferred) {
        next = { ...project, cloudRepo: inferred };
        changed = true;
      }
    }
    return next;
  });

  const sameLength = normalized.length === store.projects.length;
  if (!sameLength) {
    changed = true;
  }

  if (changed) {
    store.projects = normalized;
    saveStore(store);
  }
  return normalized;
}

function openExternalUrl(targetUrl: string): { ok: boolean; message: string } {
  const value = targetUrl.trim();
  if (!value) {
    return { ok: false, message: "Remote URL is missing." };
  }
  if (!/^https?:\/\//i.test(value)) {
    return { ok: false, message: "Only http/https remote URLs are supported." };
  }
  void shell.openExternal(value);
  return { ok: true, message: "Opened remote in browser." };
}

function getCloudProjects(): ProjectEntry[] {
  const store = loadStore();
  const cloud = store.meta.cloudProjects ?? [];
  const fallbackIso = store.meta.cloudLastSyncIso ?? new Date().toISOString();
  let changed = false;
  const normalized = cloud.map((item) => {
    if (item.lastOpenedIso && item.lastOpenedIso.trim().length > 0) {
      return item;
    }
    changed = true;
    return {
      ...item,
      lastOpenedIso: fallbackIso,
    };
  });
  if (changed) {
    store.meta.cloudProjects = normalized;
    saveStore(store);
  }
  return normalized;
}

async function refreshCloudProjectMetadata(force = false): Promise<ProjectEntry[]> {
  const store = loadStore();
  const current = store.meta.cloudProjects ?? [];
  if (current.length === 0) {
    return [];
  }

  const now = Date.now();
  const lastRefreshed = Date.parse(store.meta.cloudMetaRefreshedIso ?? "");
  const isFresh = Number.isFinite(lastRefreshed) && (now - lastRefreshed) < 10 * 60 * 1000;
  if (!force && isFresh) {
    return current;
  }

  const { token: githubToken } = getEffectiveGitHubToken();
  const gitlabToken = getGlabToken();
  if (!githubToken && !gitlabToken) {
    return current;
  }

  const updated = await mapWithConcurrency(
    current,
    async (item) => {
      const repo = (item.cloudRepo ?? "").trim();
      if (!repo) {
        return item;
      }
      const source = item.id.startsWith("gitlab:") ? "gitlab" : "github";
      const meta = source === "gitlab"
        ? (gitlabToken ? await fetchGitLabRepoMeta(gitlabToken, repo) : null)
        : (githubToken ? await fetchGitHubRepoMeta(githubToken, repo) : null);
      if (!meta) {
        return item;
      }
      return {
        ...item,
        lastOpenedIso: meta.pushedAtIso || item.lastOpenedIso,
        repoSizeBytes: meta.repoSizeBytes,
      };
    },
    6,
  );

  store.meta.cloudProjects = updated;
  store.meta.cloudMetaRefreshedIso = new Date().toISOString();
  saveStore(store);
  return updated;
}

function setCloudProjects(projects: ProjectEntry[]): ProjectEntry[] {
  const store = loadStore();
  store.meta.cloudProjects = dedupeCloudProjects(projects);
  store.meta.cloudLastSyncIso = new Date().toISOString();
  saveStore(store);
  return store.meta.cloudProjects;
}

function removeCloudProjectById(id: string): ProjectEntry[] {
  const store = loadStore();
  const current = store.meta.cloudProjects ?? [];
  store.meta.cloudProjects = current.filter((x) => x.id !== id);
  saveStore(store);
  return store.meta.cloudProjects;
}

function inferRepoFolderName(project: ProjectEntry): string {
  const fromRepo = (project.cloudRepo ?? "").split("/").pop()?.trim();
  if (fromRepo) {
    return fromRepo.replace(/[<>:"/\\|?*]+/g, "_");
  }
  const fromName = (project.name || project.nickname || "repo").trim();
  return fromName.replace(/[<>:"/\\|?*]+/g, "_");
}

async function cloneCloudProject(projectId: string, targetDir: string): Promise<{ ok: boolean; message: string; projects: ProjectEntry[] }> {
  const store = loadStore();
  const cloudProjects = store.meta.cloudProjects ?? [];
  const cloudProject = cloudProjects.find((item) => item.id === projectId);
  if (!cloudProject) {
    return { ok: false, message: "Cloud project not found.", projects: store.projects };
  }
  if (!cloudProject.cloneUrl?.trim()) {
    return { ok: false, message: "Cloud project clone URL is missing.", projects: store.projects };
  }
  const targetPath = targetDir.trim();
  if (!targetPath) {
    return { ok: false, message: "Target folder is required.", projects: store.projects };
  }

  if (existsSync(targetPath)) {
    return { ok: false, message: "Target folder already exists.", projects: store.projects };
  }

  const cloneResult = await cloneRepository(cloudProject.cloneUrl, targetPath, "");
  if (!cloneResult.ok) {
    return { ok: false, message: cloneResult.message, projects: store.projects };
  }

  const created: ProjectEntry = {
    id: randomUUID(),
    nickname: cloudProject.nickname,
    name: cloudProject.name || inferRepoFolderName(cloudProject),
    path: targetPath,
    unityVersion: cloudProject.unityVersion || detectUnityVersion(targetPath),
    unityExe: "",
    lastOpenedIso: "",
    cloudRepo: cloudProject.cloudRepo ?? "",
    cloneUrl: cloudProject.cloneUrl ?? "",
  };

  store.projects.push(created);
  store.meta.cloudProjects = cloudProjects.filter((item) => item.id !== projectId);
  saveStore(store);
  return { ok: true, message: "Cloud project cloned and added.", projects: store.projects };
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
  const store = loadStore();
  const disableRenderThrottling = store.meta.disableRenderThrottling ?? true;
  const bgColor = nativeTheme.shouldUseDarkColors ? "#121212" : "#f4f4f4";
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1280,
    height: 760,
    minWidth: 800,
    minHeight: 400,
    show: false,
    backgroundColor: bgColor,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: !disableRenderThrottling,
    },
  };

  if (process.platform === "win32" || process.platform === "darwin") {
    windowOptions.titleBarStyle = "hidden";
    if (process.platform === "win32") {
      windowOptions.titleBarOverlay = {
        color: bgColor,
        symbolColor: nativeTheme.shouldUseDarkColors ? "#e8e8e8" : "#1b1b1b",
        height: 30,
      };
    }
  }

  const win = new BrowserWindow(windowOptions);
  win.setMenuBarVisibility(false);

  const htmlPath = path.join(__dirname, "renderer", "index.html");
  win.loadFile(htmlPath);
  win.once("ready-to-show", () => {
    win.show();
  });
}

app.whenReady().then(() => {
  const dataFile = getDataFile();
  const dir = path.dirname(dataFile);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const store = loadStore();
  const bootstrapped = bootstrapFromHubOnFirstRun(store);
  saveStore(bootstrapped);

  ipcMain.handle("projects:get", () => getNormalizedLocalProjects());
  ipcMain.handle("projects:getCloud", async () => {
    await refreshCloudProjectMetadata(false);
    return getCloudProjects();
  });
  ipcMain.handle("projects:save", (_event, project: ProjectEntry) => upsertProject(project));
  ipcMain.handle("projects:delete", (_event, id: string) => deleteProject(id));
  ipcMain.handle("projects:deleteCloud", (_event, id: string) => removeCloudProjectById(id));
  ipcMain.handle("projects:cloneCloud", async (_event, projectId: string, targetDir: string) => cloneCloudProject(projectId, targetDir));
  ipcMain.handle("projects:removeMissing", () => removeMissingProjects());
  ipcMain.handle("projects:syncFromUnityHub", () => syncProjectsFromUnityHub());
  ipcMain.handle("settings:get", () => {
    const store = loadStore();
    return {
      disableRenderThrottling: store.meta.disableRenderThrottling ?? true,
    };
  });
  ipcMain.handle("settings:setDisableRenderThrottling", (_event, value: boolean) => {
    const store = loadStore();
    store.meta.disableRenderThrottling = value;
    saveStore(store);
    return { ok: true };
  });
  ipcMain.handle("unity:detectVersion", (_event, projectPath: string) => detectUnityVersion(projectPath));
  ipcMain.handle("unity:projectIcon", (_event, projectPath: string) => detectProjectIconDataUrl(projectPath));
  ipcMain.handle("project:remoteUrl", (_event, projectPath: string) => getProjectRemoteUrl(projectPath));
  ipcMain.handle("project:lastCommitIso", async (_event, projectPath: string) => getProjectLastCommitIso(projectPath));
  ipcMain.handle("project:sizeBytes", (_event, projectPath: string) => getProjectSizeBytes(projectPath));
  ipcMain.handle("vcs:status", async (_event, projectPath: string) => getVcsStatus(projectPath));
  ipcMain.handle("vcs:gitCommitPush", (_event, projectPath: string) => gitCommitAndPush(projectPath));
  ipcMain.handle("vcs:gitPull", (_event, projectPath: string) => gitPull(projectPath));
  ipcMain.handle("project:isOpen", (_event, projectPath: string) => projectIsOpen(projectPath));
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
  ipcMain.handle("path:browseTo", (_event, targetPath: string) => browseToPath(targetPath));
  ipcMain.handle("url:openExternal", (_event, targetUrl: string) => openExternalUrl(targetUrl));
  ipcMain.handle("dialog:pickDirectory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return "";
    }
    return result.filePaths[0];
  });
  ipcMain.handle("dialog:pickCloneTarget", async (_event, defaultParentDir: string, suggestedFolderName: string) => {
    const safeFolder = (suggestedFolderName || "project").replace(/[<>:"/\\|?*]+/g, "_");
    const baseDir = defaultParentDir?.trim() ? defaultParentDir.trim() : app.getPath("documents");
    const defaultPath = path.join(baseDir, safeFolder);
    const result = await dialog.showSaveDialog({
      title: "Choose clone target folder",
      buttonLabel: "Select Folder",
      defaultPath,
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (result.canceled || !result.filePath) {
      return "";
    }
    return result.filePath;
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
  ipcMain.handle("repo:clone", async (_event, repoUrl: string, targetDir: string, branch: string) =>
    cloneRepository(repoUrl, targetDir, branch),
  );
  ipcMain.handle("github:getAuthStatus", async () => getGitHubAuthStatus());
  ipcMain.handle("gitlab:getAuthStatus", async () => getGitLabAuthStatus());
  ipcMain.handle("github:discoverCloudProjects", async () => {
    const { token } = getEffectiveGitHubToken();
    if (!token) {
      return {
        ok: false,
        message: "GitHub CLI auth is required. Run `gh auth login` first.",
        projects: [] as ProjectEntry[],
      };
    }
    try {
      const existing = getCloudProjects().filter((project) => !project.id.startsWith("github:"));
      const cloud = await discoverUnityCloudProjects(token);
      const persisted = setCloudProjects([...existing, ...cloud]);
      await refreshCloudProjectMetadata(true);
      return { ok: true, message: `Discovered ${cloud.length} GitHub cloud Unity projects.`, projects: persisted };
    } catch (error) {
      return { ok: false, message: `GitHub discovery failed: ${String(error)}`, projects: [] as ProjectEntry[] };
    }
  });
  ipcMain.handle("gh:getStatus", async () => {
    const status = await getGitHubAuthStatus();
    return {
      installed: status.ghInstalled,
      authenticated: status.ghAuthenticated,
      login: status.login,
      installHint: status.installHint,
      installUrl: status.installUrl,
      message: status.message,
    };
  });
  ipcMain.handle("gitlab:discoverCloudProjects", async () => {
    const token = getGlabToken();
    if (!token) {
      return {
        ok: false,
        message: "GitLab CLI auth is required. Run `glab auth login` first.",
        projects: [] as ProjectEntry[],
      };
    }
    try {
      const existing = getCloudProjects().filter((project) => !project.id.startsWith("gitlab:"));
      const cloud = await discoverUnityGitLabCloudProjects(token);
      const persisted = setCloudProjects([...existing, ...cloud]);
      await refreshCloudProjectMetadata(true);
      return { ok: true, message: `Discovered ${cloud.length} GitLab cloud Unity projects.`, projects: persisted };
    } catch (error) {
      return { ok: false, message: `GitLab discovery failed: ${String(error)}`, projects: [] as ProjectEntry[] };
    }
  });
  ipcMain.handle("deps:getStatus", async () => getDependencyStatus());
  ipcMain.handle("deps:getGitInstallGuide", () => ({
    command: installCommandForGit(),
    url: "https://git-scm.com/downloads",
    message: getGitInstallHint(),
  }));
  ipcMain.handle("deps:getGhInstallGuide", () => ({
    command: installCommandForGh(),
    url: "https://cli.github.com/",
    message: getGhInstallHint(),
  }));
  ipcMain.handle("deps:startGhAuth", () => startGhAuthLogin());
  ipcMain.handle("deps:getGlabInstallGuide", () => ({
    command: installCommandForGlab(),
    url: "https://gitlab.com/gitlab-org/cli",
    message: getGlabInstallHint(),
  }));
  ipcMain.handle("deps:startGlabInstall", () => startGlabInstall());
  ipcMain.handle("deps:startGlabAuth", () => startGlabAuthLogin());
  ipcMain.handle("deps:getHubInstallGuide", () => ({
    command: installCommandForHub(),
    url: "https://unity.com/download",
    message: getHubInstallHint(),
  }));
  ipcMain.handle("gh:openInstall", () => {
    const url = "https://cli.github.com/";
    void shell.openExternal(url);
    return { ok: true, message: getGhInstallHint(), url };
  });

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


