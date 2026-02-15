(function () {
  const projectsKey = "pages.projects";
  const installsKey = "pages.installs";
  const settingsKey = "pages.settings";

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

  function getSettings() {
    return readJson(settingsKey, { disableRenderThrottling: true });
  }

  window.launcherApi = {
    async getProjects() {
      return getProjects();
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
  };
})();
