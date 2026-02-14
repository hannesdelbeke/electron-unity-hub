(function () {
  /** @typedef {{id:string,nickname:string,name:string,path:string,unityVersion:string,vcs:string,lastOpenedIso:string}} DemoProject */

  /** @type {DemoProject[]} */
  let projects = [
    {
      id: "1",
      nickname: "Main",
      name: "space-rpg",
      path: "D:/repos/space-rpg",
      unityVersion: "6000.0.31f1",
      vcs: "Git main (clean)",
      lastOpenedIso: "2026-02-14T08:31:00Z",
    },
    {
      id: "2",
      nickname: "Feature UI",
      name: "space-rpg",
      path: "D:/repos/space-rpg-ui",
      unityVersion: "6000.0.31f1",
      vcs: "Git feature/ui-overhaul (dirty)",
      lastOpenedIso: "2026-02-13T21:11:00Z",
    },
    {
      id: "3",
      nickname: "P4 Stream",
      name: "studio-game",
      path: "D:/workspace/studio-game",
      unityVersion: "2022.3.63f1",
      vcs: "Perforce //Game/Main (clean)",
      lastOpenedIso: "2026-02-11T18:09:00Z",
    },
  ];

  let selectedId = "";
  let searchText = "";

  const tbody = document.querySelector("#projects-table tbody");
  const statusEl = document.getElementById("status");
  const searchInput = document.getElementById("search");
  const addToggle = document.getElementById("add-toggle");
  const addMenu = document.getElementById("add-menu");

  const diskDialog = document.getElementById("disk-dialog");
  const repoDialog = document.getElementById("repo-dialog");

  const diskPath = document.getElementById("disk-path");
  const diskNickname = document.getElementById("disk-nickname");
  const diskUnityExe = document.getElementById("disk-unity-exe");

  const repoUrl = document.getElementById("repo-url");
  const repoBranch = document.getElementById("repo-branch");
  const repoTarget = document.getElementById("repo-target");
  const repoNickname = document.getElementById("repo-nickname");

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  function filteredProjects() {
    const q = searchText.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => [p.nickname, p.name, p.path, p.unityVersion, p.vcs].some((x) => x.toLowerCase().includes(q)));
  }

  function renderTable() {
    if (!tbody) return;
    tbody.innerHTML = "";
    for (const project of filteredProjects()) {
      const tr = document.createElement("tr");
      if (project.id === selectedId) tr.classList.add("selected");
      tr.addEventListener("click", () => {
        selectedId = project.id;
        renderTable();
      });

      const values = [
        project.nickname,
        project.name,
        project.path,
        project.unityVersion,
        project.vcs,
        new Date(project.lastOpenedIso).toLocaleString(),
      ];

      for (const value of values) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  function clearDiskForm() {
    diskPath.value = "";
    diskNickname.value = "";
    diskUnityExe.value = "";
  }

  function clearRepoForm() {
    repoUrl.value = "";
    repoBranch.value = "";
    repoTarget.value = "";
    repoNickname.value = "";
  }

  function id() {
    return Math.random().toString(36).slice(2, 10);
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
      id: id(),
      nickname: diskNickname.value.trim() || name,
      name,
      path: projectPath,
      unityVersion: "Detected in desktop app",
      vcs: "Detected in desktop app",
      lastOpenedIso: new Date().toISOString(),
    });
    diskDialog.close();
    clearDiskForm();
    renderTable();
    setStatus("Demo: project added from disk (mock)");
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
      id: id(),
      nickname: repoNickname.value.trim() || name,
      name,
      path: target,
      unityVersion: "Detected in desktop app",
      vcs: `Git ${branch} (mock)`,
      lastOpenedIso: new Date().toISOString(),
    });
    repoDialog.close();
    clearRepoForm();
    renderTable();
    setStatus("Demo: repo cloned and added (mock)");
  }

  function removeSelected() {
    if (!selectedId) {
      setStatus("Select a project first");
      return;
    }
    projects = projects.filter((p) => p.id !== selectedId);
    selectedId = "";
    renderTable();
    setStatus("Demo: project removed");
  }

  function launchSelected() {
    if (!selectedId) {
      setStatus("Select a project first");
      return;
    }
    const project = projects.find((p) => p.id === selectedId);
    if (!project) {
      setStatus("Project not found");
      return;
    }
    setStatus(`Demo: would launch/focus ${project.nickname}`);
  }

  addToggle.addEventListener("click", () => addMenu.classList.toggle("hidden"));
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.closest(".add-wrap")) addMenu.classList.add("hidden");
  });

  searchInput.addEventListener("input", () => {
    searchText = searchInput.value;
    renderTable();
  });

  document.getElementById("add-disk").addEventListener("click", () => {
    addMenu.classList.add("hidden");
    diskDialog.showModal();
  });
  document.getElementById("add-repo").addEventListener("click", () => {
    addMenu.classList.add("hidden");
    repoDialog.showModal();
  });
  document.getElementById("disk-save").addEventListener("click", (event) => {
    event.preventDefault();
    addFromDisk();
  });
  document.getElementById("repo-save").addEventListener("click", (event) => {
    event.preventDefault();
    addFromRepo();
  });

  document.getElementById("new-project").addEventListener("click", () => {
    setStatus("Demo: New Project opens Unity Hub in desktop app");
  });
  document.getElementById("launch-btn").addEventListener("click", launchSelected);
  document.getElementById("delete-btn").addEventListener("click", removeSelected);
  document.getElementById("refresh-btn").addEventListener("click", () => {
    renderTable();
    setStatus("Demo refreshed");
  });

  renderTable();
})();
