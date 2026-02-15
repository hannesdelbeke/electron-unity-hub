import { contextBridge, ipcRenderer } from "electron";
import type { ProjectEntry } from "./types";

contextBridge.exposeInMainWorld("launcherApi", {
  getProjects: () => ipcRenderer.invoke("projects:get"),
  getCloudProjects: () => ipcRenderer.invoke("projects:getCloud"),
  saveProject: (project: ProjectEntry) => ipcRenderer.invoke("projects:save", project),
  deleteProject: (id: string) => ipcRenderer.invoke("projects:delete", id),
  deleteCloudProject: (id: string) => ipcRenderer.invoke("projects:deleteCloud", id),
  cloneCloudProject: (projectId: string, targetDir: string) => ipcRenderer.invoke("projects:cloneCloud", projectId, targetDir),
  removeMissingProjects: () => ipcRenderer.invoke("projects:removeMissing"),
  syncFromUnityHub: () => ipcRenderer.invoke("projects:syncFromUnityHub"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setDisableRenderThrottling: (value: boolean) => ipcRenderer.invoke("settings:setDisableRenderThrottling", value),
  detectUnityVersion: (projectPath: string) => ipcRenderer.invoke("unity:detectVersion", projectPath),
  getProjectIcon: (projectPath: string) => ipcRenderer.invoke("unity:projectIcon", projectPath),
  getProjectRemoteUrl: (projectPath: string) => ipcRenderer.invoke("project:remoteUrl", projectPath),
  getProjectLastCommitIso: (projectPath: string) => ipcRenderer.invoke("project:lastCommitIso", projectPath),
  getProjectSizeBytes: (projectPath: string) => ipcRenderer.invoke("project:sizeBytes", projectPath),
  getVcsStatus: (projectPath: string) => ipcRenderer.invoke("vcs:status", projectPath),
  gitCommitPush: (projectPath: string) => ipcRenderer.invoke("vcs:gitCommitPush", projectPath),
  gitPull: (projectPath: string) => ipcRenderer.invoke("vcs:gitPull", projectPath),
  isProjectOpen: (projectPath: string) => ipcRenderer.invoke("project:isOpen", projectPath),
  getUnityInstalls: () => ipcRenderer.invoke("unity:installs"),
  launchOrFocus: (project: ProjectEntry) => ipcRenderer.invoke("unity:launchOrFocus", project),
  launchUnityEditor: (editorPath: string) => ipcRenderer.invoke("unity:launchEditor", editorPath),
  browseTo: (targetPath: string) => ipcRenderer.invoke("path:browseTo", targetPath),
  openExternalUrl: (targetUrl: string) => ipcRenderer.invoke("url:openExternal", targetUrl),
  pickDirectory: () => ipcRenderer.invoke("dialog:pickDirectory"),
  pickCloneTarget: (defaultParentDir: string, suggestedFolderName: string) =>
    ipcRenderer.invoke("dialog:pickCloneTarget", defaultParentDir, suggestedFolderName),
  pickFile: () => ipcRenderer.invoke("dialog:pickFile"),
  cloneRepo: (repoUrl: string, targetDir: string, branch: string) =>
    ipcRenderer.invoke("repo:clone", repoUrl, targetDir, branch),
  getGitHubAuthStatus: () => ipcRenderer.invoke("github:getAuthStatus"),
  discoverCloudProjects: () => ipcRenderer.invoke("github:discoverCloudProjects"),
  getGhStatus: () => ipcRenderer.invoke("gh:getStatus"),
  openGhInstall: () => ipcRenderer.invoke("gh:openInstall"),
});
