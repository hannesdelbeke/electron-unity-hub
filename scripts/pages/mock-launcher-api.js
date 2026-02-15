(function () {
  const projectsKey = "pages.projects";
  const cloudProjectsKey = "pages.cloudProjects";
  const installsKey = "pages.installs";
  const settingsKey = "pages.settings";
  const githubKey = "pages.githubAuth";

  function nowIso() {
    return new Date().toISOString();
  }

  function randomId() {
    return Math.random().toString(36).slice(2, 10);
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function seedProjects() {
    return [
      {
        id: randomId(),
        nickname: "Main",
        name: "space-rpg",
        path: "D:/repos/space-rpg",
        unityVersion: "6000.0.31f1",
        unityExe: "C:/Program Files/Unity/Hub/Editor/6000.0.31f1/Editor/Unity.exe",
        lastOpenedIso: nowIso(),
      },
      {
        id: randomId(),
        nickname: "",
        name: "studio-game",
        path: "D:/workspace/missing-project",
        unityVersion: "2022.3.63f1",
        unityExe: "D:/Unity/2022.3.63f1/Editor/Unity.exe",
        lastOpenedIso: "2026-02-13T19:15:00.000Z",
      },
    ];
  }

  function seedCloudProjects() {
    return [
      {
        id: "github:demo/studio-cloud-game",
        nickname: "studio-cloud-game",
        name: "studio-cloud-game",
        path: "",
        unityVersion: "6000.0.43f1",
        unityExe: "",
        lastOpenedIso: "2026-02-15T08:22:00.000Z",
        cloudRepo: "demo/studio-cloud-game",
        cloneUrl: "https://github.com/demo/studio-cloud-game.git",
        repoSizeBytes: 2.4 * 1024 * 1024 * 1024,
      },
    ];
  }

  function seedInstalls() {
    return [
      {
        version: "6000.0.31f1",
        path: "C:/Program Files/Unity/Hub/Editor/6000.0.31f1/Editor/Unity.exe",
        source: "Hub-style path",
        exists: true,
      },
      {
        version: "2022.3.63f1",
        path: "D:/Unity/2022.3.63f1/Editor/Unity.exe",
        source: "Manual",
        exists: true,
      },
      {
        version: "2021.3.45f1",
        path: "D:/Unity/missing/Editor/Unity.exe",
        source: "Manual",
        exists: false,
      },
    ];
  }

  function getProjects() {
    const projects = readJson(projectsKey, null);
    if (projects) return projects;
    const seeded = seedProjects();
    writeJson(projectsKey, seeded);
    return seeded;
  }

  function saveProjects(projects) {
    writeJson(projectsKey, projects);
  }

  function getInstalls() {
    const installs = readJson(installsKey, null);
    if (installs) return installs;
    const seeded = seedInstalls();
    writeJson(installsKey, seeded);
    return seeded;
  }

  function getCloudProjects() {
    const cloud = readJson(cloudProjectsKey, null);
    if (cloud) return cloud;
    const seeded = seedCloudProjects();
    writeJson(cloudProjectsKey, seeded);
    return seeded;
  }

  function saveCloudProjects(projects) {
    writeJson(cloudProjectsKey, projects);
  }

  function getSettings() {
    return readJson(settingsKey, { disableRenderThrottling: true });
  }

  function getGitHub() {
    return readJson(githubKey, { connected: false, login: "" });
  }

  function saveGitHub(value) {
    writeJson(githubKey, value);
  }

  window.launcherApi = {
    async getProjects() {
      return getProjects();
    },
    async getCloudProjects() {
      return getCloudProjects();
    },
    async saveProject(project) {
      const current = getProjects();
      const next = [...current];
      const incoming = { ...project };
      if (!incoming.id) incoming.id = randomId();
      if (!incoming.lastOpenedIso) incoming.lastOpenedIso = nowIso();
      const index = next.findIndex((item) => item.id === incoming.id);
      if (index >= 0) next[index] = incoming;
      else next.push(incoming);
      saveProjects(next);
      return next;
    },
    async deleteProject(id) {
      const next = getProjects().filter((item) => item.id !== id);
      saveProjects(next);
      return next;
    },
    async deleteCloudProject(id) {
      const next = getCloudProjects().filter((item) => item.id !== id);
      saveCloudProjects(next);
      return next;
    },
    async cloneCloudProject(projectId, parentDir) {
      const cloud = getCloudProjects();
      const target = cloud.find((item) => item.id === projectId);
      if (!target) return { ok: false, message: "Cloud project not found.", projects: getProjects() };
      const folder = (target.name || "project").replace(/[<>:\"/\\\\|?*]+/g, "_");
      const clonedPath = `${parentDir}/${folder}`;
      const local = {
        ...target,
        id: randomId(),
        path: clonedPath,
        lastOpenedIso: nowIso(),
      };
      const projects = [...getProjects(), local];
      saveProjects(projects);
      saveCloudProjects(cloud.filter((item) => item.id !== projectId));
      return { ok: true, message: "Demo: cloned cloud project.", projects };
    },
    async removeMissingProjects() {
      const before = getProjects();
      const next = before.filter((item) => !item.path.toLowerCase().includes("missing"));
      saveProjects(next);
      return { removed: before.length - next.length, remaining: next.length };
    },
    async getUnityInstalls() {
      return getInstalls();
    },
    async detectUnityVersion() {
      return "6000.0.31f1";
    },
    async getVcsStatus(projectPath) {
      const value = (projectPath || "").toLowerCase();
      if (value.includes("missing")) {
        return {
          kind: "None",
          branchOrStream: "",
          state: "missing path",
          localChangesCount: 0,
          incomingCount: 0,
          outgoingCount: 0,
          conflictCount: 0,
        };
      }
      if (value.includes("space")) {
        return {
          kind: "Git",
          branchOrStream: "main",
          state: "clean",
          localChangesCount: 2,
          incomingCount: 1,
          outgoingCount: 3,
          conflictCount: 0,
        };
      }
      return {
        kind: "Perforce",
        branchOrStream: "//Game/Main",
        state: "dirty",
        localChangesCount: 4,
        incomingCount: 1,
        outgoingCount: 0,
        conflictCount: 0,
      };
    },
    async isProjectOpen(projectPath) {
      const value = (projectPath || "").toLowerCase();
      return value.includes("space");
    },
    async getProjectIcon() {
      return "./assets/unityhub.png";
    },
    async getProjectRemoteUrl(projectPath) {
      const value = (projectPath || "").toLowerCase();
      if (value.includes("space")) return "https://github.com/demo/space-rpg";
      if (value.includes("missing")) return "https://github.com/demo/studio-game";
      return "";
    },
    async getProjectLastCommitIso(projectPath) {
      const value = (projectPath || "").toLowerCase();
      if (!value) return "";
      if (value.includes("missing")) return "";
      return "2026-02-14T21:10:00.000Z";
    },
    async getProjectSizeBytes(projectPath) {
      const value = (projectPath || "").toLowerCase();
      if (value.includes("space")) return 12 * 1024 * 1024 * 1024;
      if (value.includes("missing")) return 0;
      return 850 * 1024 * 1024;
    },
    async launchOrFocus(project) {
      const current = getProjects();
      const next = current.map((item) =>
        item.id === project.id ? { ...item, lastOpenedIso: nowIso() } : item,
      );
      saveProjects(next);
      return { ok: true, message: `Demo: would launch ${project.nickname || project.name}` };
    },
    async launchUnityEditor(editorPath) {
      return { ok: true, message: `Demo: would launch ${editorPath}` };
    },
    async browseTo(targetPath) {
      if (!targetPath) return { ok: false, message: "Path is required." };
      return { ok: true, message: `Demo: would browse to ${targetPath}` };
    },
    async openExternalUrl(targetUrl) {
      if (!targetUrl) return { ok: false, message: "Remote URL is missing." };
      return { ok: true, message: `Demo: would open ${targetUrl}` };
    },
    async pickDirectory() {
      return window.prompt("Mock folder path", "D:/repos/new-project") || "";
    },
    async pickFile() {
      return window.prompt("Mock executable path", "D:/Unity/Editor/Unity.exe") || "";
    },
    async cloneRepo(url, target, branch) {
      if (!url || !target) return { ok: false, message: "Repository URL and target folder are required." };
      return { ok: true, message: `Demo: cloned ${url} ${branch ? `(${branch})` : ""}`.trim() };
    },
    async getSettings() {
      return getSettings();
    },
    async setDisableRenderThrottling(value) {
      writeJson(settingsKey, { ...getSettings(), disableRenderThrottling: !!value });
      return { ok: true };
    },
    async getGitHubAuthStatus() {
      const info = getGitHub();
      return {
        ghInstalled: true,
        ghAuthenticated: !!info.connected,
        connected: !!info.connected,
        login: info.login || "",
        source: info.connected ? "gh" : "none",
        installHint: "Install with Homebrew/winget/apt from cli.github.com",
        installUrl: "https://cli.github.com/",
        message: info.connected ? "Connected" : "Not connected",
      };
    },
    async setGitHubToken(token) {
      if (!token || token.trim().length < 4) {
        return { ok: false, message: "Token is invalid." };
      }
      saveGitHub({ connected: true, login: "demo-user" });
      return { ok: true, message: "Connected as demo-user." };
    },
    async clearGitHubToken() {
      saveGitHub({ connected: false, login: "" });
      return { ok: true };
    },
    async discoverCloudProjects() {
      const gh = getGitHub();
      if (!gh.connected) {
        return { ok: false, message: "GitHub is not connected.", projects: [] };
      }
      const projects = getCloudProjects();
      return { ok: true, message: `Discovered ${projects.length} cloud Unity projects.`, projects };
    },
    async getGhStatus() {
      const gh = getGitHub();
      return {
        installed: true,
        authenticated: !!gh.connected,
        login: gh.login || "",
        installHint: "Install from cli.github.com",
        installUrl: "https://cli.github.com/",
        message: gh.connected ? "Authenticated" : "Not authenticated",
      };
    },
    async openGhInstall() {
      return { ok: true, message: "Install with your OS package manager or from cli.github.com", url: "https://cli.github.com/" };
    },
  };
})();
