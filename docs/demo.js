(function () {
  const projectsTableBody = document.querySelector("#projects-table tbody");
  const installsTableBody = document.querySelector("#installs-table tbody");
  const statusEl = document.getElementById("status");

  const tabProjects = document.getElementById("tab-projects");
  const tabInstalls = document.getElementById("tab-installs");
  const tabSettings = document.getElementById("tab-settings");

  const viewProjects = document.getElementById("view-projects");
  const viewInstalls = document.getElementById("view-installs");
  const viewSettings = document.getElementById("view-settings");

  const searchInput = document.getElementById("search");
  const addToggle = document.getElementById("add-toggle");
  const addMenu = document.getElementById("add-menu");
  const projectsMoreToggle = document.getElementById("projects-more-toggle");
  const projectsMoreMenu = document.getElementById("projects-more-menu");

  const diskDialog = document.getElementById("disk-dialog");
  const repoDialog = document.getElementById("repo-dialog");

  const diskPath = document.getElementById("disk-path");
  const diskNickname = document.getElementById("disk-nickname");
  const repoUrl = document.getElementById("repo-url");
  const repoBranch = document.getElementById("repo-branch");
  const repoTarget = document.getElementById("repo-target");
  const repoNickname = document.getElementById("repo-nickname");

  const settingsTheme = document.getElementById("settings-theme");
  const settingsDefaultExe = document.getElementById("settings-default-unity-exe");

  let selectedId = "";
  let searchText = "";

  /** @type {Array<{id:string,nickname:string,name:string,path:string,unityVersion:string,vcs:string,lastOpenedIso:string,missing:boolean}>} */
  let projects = [
    {
      id: "1",
      nickname: "Main",
      name: "space-rpg",
      path: "D:/repos/space-rpg",
      unityVersion: "6000.0.31f1",
      vcs: "Git main (clean)",
      lastOpenedIso: "2026-02-14T08:31:00Z",
      missing: false,
    },
    {
      id: "2",
      nickname: "Feature UI",
      name: "space-rpg",
      path: "D:/repos/space-rpg-ui",
      unityVersion: "6000.0.31f1",
      vcs: "Git feature/ui-overhaul (dirty)",
      lastOpenedIso: "2026-02-13T21:11:00Z",
      missing: false,
    },
    {
      id: "3",
      nickname: "Missing Project",
      name: "studio-game",
      path: "D:/workspace/missing-project",
      unityVersion: "2022.3.63f1",
      vcs: "Perforce //Game/Main (clean)",
      lastOpenedIso: "2026-02-11T18:09:00Z",
      missing: true,
    },
  ];

  /** @type {Array<{version:string,path:string,source:string,exists:boolean}>} */
  const installs = [
    { version: "6000.0.31f1", path: "C:/Program Files/Unity/Hub/Editor/6000.0.31f1/Editor/Unity.exe", source: "Hub-style path", exists: true },
    { version: "2022.3.63f1", path: "D:/Unity/2022.3.63f1/Editor/Unity.exe", source: "Program Files", exists: true },
    { version: "2021.3.45f1", path: "D:/Unity/missing/Editor/Unity.exe", source: "Metadata", exists: false },
  ];

  function setStatus(message) {
    if (statusEl) statusEl.textContent = message;
  }

  function warningLabel(missing) {
    return missing ? '<span class="warning-pill">Missing</span>' : "";
  }

  function displayName(project) {
    const nickname = project.nickname.trim();
    return nickname || project.name;
  }

  function activateTab(tab) {
    tabProjects.classList.toggle("active", tab === "projects");
    tabInstalls.classList.toggle("active", tab === "installs");
    tabSettings.classList.toggle("active", tab === "settings");

    viewProjects.classList.toggle("active", tab === "projects");
    viewInstalls.classList.toggle("active", tab === "installs");
    viewSettings.classList.toggle("active", tab === "settings");
  }

  function closeAddMenu() {
    addMenu.classList.add("hidden");
  }

  function closeProjectsMenu() {
    projectsMoreMenu.classList.add("hidden");
  }

  function filteredProjects() {
    const q = searchText.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => [displayName(p), p.path, p.unityVersion, p.vcs].some((value) => value.toLowerCase().includes(q)));
  }

  function renderProjects() {
    projectsTableBody.innerHTML = "";
    for (const project of filteredProjects()) {
      const tr = document.createElement("tr");
      tr.classList.add("clickable");
      if (project.id === selectedId) tr.classList.add("selected");
      tr.innerHTML = `
        <td>${displayName(project)}</td>
        <td>${project.path}</td>
        <td>${project.unityVersion}</td>
        <td>${project.vcs}</td>
        <td>${new Date(project.lastOpenedIso).toLocaleString()}</td>
        <td>${warningLabel(project.missing)}</td>
      `;

      tr.addEventListener("click", () => {
        selectedId = project.id;
        renderProjects();
        if (project.missing) {
          setStatus("Demo: project path is missing");
          return;
        }
        setStatus(`Demo: would launch/focus ${displayName(project)}`);
      });

      projectsTableBody.appendChild(tr);
    }
  }

  function renderInstalls() {
    installsTableBody.innerHTML = "";
    for (const install of installs) {
      const tr = document.createElement("tr");
      tr.classList.add("clickable");
      tr.innerHTML = `
        <td>${install.version}</td>
        <td>${install.path}</td>
        <td>${install.source}</td>
        <td>${warningLabel(!install.exists)}</td>
      `;
      tr.addEventListener("click", () => {
        if (!install.exists) {
          setStatus("Demo: unity install path is missing");
          return;
        }
        setStatus(`Demo: would launch editor ${install.version}`);
      });
      installsTableBody.appendChild(tr);
    }
  }

  function inferName(pathValue) {
    const parts = pathValue.split(/[\\/]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "Project";
  }

  function addFromDisk() {
    const projectPath = diskPath.value.trim();
    if (!projectPath) {
      setStatus("Project folder is required");
      return;
    }

    const name = inferName(projectPath);
    projects.unshift({
      id: Math.random().toString(36).slice(2, 10),
      nickname: diskNickname.value.trim(),
      name,
      path: projectPath,
      unityVersion: "Detected in desktop app",
      vcs: "Detected in desktop app",
      lastOpenedIso: new Date().toISOString(),
      missing: false,
    });

    diskDialog.close();
    diskPath.value = "";
    diskNickname.value = "";
    renderProjects();
    setStatus("Demo: project added from disk");
  }

  function addFromRepo() {
    const url = repoUrl.value.trim();
    const target = repoTarget.value.trim();
    if (!url || !target) {
      setStatus("Repository URL and target folder are required");
      return;
    }

    const name = inferName(target);
    const branch = repoBranch.value.trim() || "main";
    projects.unshift({
      id: Math.random().toString(36).slice(2, 10),
      nickname: repoNickname.value.trim(),
      name,
      path: target,
      unityVersion: "Detected in desktop app",
      vcs: `Git ${branch} (mock)`,
      lastOpenedIso: new Date().toISOString(),
      missing: false,
    });

    repoDialog.close();
    repoUrl.value = "";
    repoBranch.value = "";
    repoTarget.value = "";
    repoNickname.value = "";
    renderProjects();
    setStatus("Demo: repo cloned and added");
  }

  addToggle.addEventListener("click", () => {
    addMenu.classList.toggle("hidden");
    closeProjectsMenu();
  });

  projectsMoreToggle.addEventListener("click", () => {
    projectsMoreMenu.classList.toggle("hidden");
    closeAddMenu();
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.closest(".add-wrap")) closeAddMenu();
    if (!target.closest(".projects-more-wrap")) closeProjectsMenu();
  });

  searchInput.addEventListener("input", () => {
    searchText = searchInput.value;
    renderProjects();
  });

  document.getElementById("new-project").addEventListener("click", () => {
    closeAddMenu();
    diskDialog.showModal();
    setStatus("Demo: new project opens add-from-disk dialog");
  });

  document.getElementById("add-disk").addEventListener("click", () => {
    closeAddMenu();
    diskDialog.showModal();
  });

  document.getElementById("add-repo").addEventListener("click", () => {
    closeAddMenu();
    repoDialog.showModal();
  });

  document.getElementById("disk-save").addEventListener("click", addFromDisk);
  document.getElementById("repo-save").addEventListener("click", addFromRepo);

  document.getElementById("refresh-btn").addEventListener("click", () => {
    renderProjects();
    setStatus("Demo projects refreshed");
  });

  document.getElementById("delete-btn").addEventListener("click", () => {
    if (!selectedId) {
      setStatus("Select a project first");
      return;
    }
    projects = projects.filter((project) => project.id !== selectedId);
    selectedId = "";
    renderProjects();
    setStatus("Demo: project removed");
  });

  document.getElementById("refresh-installs").addEventListener("click", () => {
    renderInstalls();
    setStatus("Demo installs refreshed");
  });

  document.getElementById("projects-menu-settings").addEventListener("click", () => {
    closeProjectsMenu();
    activateTab("settings");
  });

  document.getElementById("projects-menu-remove").addEventListener("click", () => {
    closeProjectsMenu();
    document.getElementById("delete-btn").click();
  });

  document.getElementById("settings-save").addEventListener("click", () => {
    const selectedTheme = settingsTheme.value;
    if (selectedTheme === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", selectedTheme);
    }
    setStatus("Demo: settings saved");
  });

  document.getElementById("settings-remove-missing").addEventListener("click", () => {
    const before = projects.length;
    projects = projects.filter((project) => !project.missing);
    const removed = before - projects.length;
    if (selectedId && !projects.some((project) => project.id === selectedId)) {
      selectedId = "";
    }
    renderProjects();
    setStatus(`Demo: removed ${removed} missing projects`);
  });

  settingsDefaultExe.addEventListener("input", () => {
    if (settingsDefaultExe.value) {
      setStatus("Demo: default editor path updated");
    }
  });

  tabProjects.addEventListener("click", () => activateTab("projects"));
  tabInstalls.addEventListener("click", () => {
    activateTab("installs");
    renderInstalls();
  });
  tabSettings.addEventListener("click", () => activateTab("settings"));

  activateTab("projects");
  renderProjects();
  renderInstalls();
})();
