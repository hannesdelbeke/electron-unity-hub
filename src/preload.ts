import { contextBridge, ipcRenderer } from "electron";
import type { ProjectEntry } from "./types";

contextBridge.exposeInMainWorld("launcherApi", {
  getProjects: () => ipcRenderer.invoke("projects:get"),
  saveProject: (project: ProjectEntry) => ipcRenderer.invoke("projects:save", project),
  deleteProject: (id: string) => ipcRenderer.invoke("projects:delete", id),
  removeMissingProjects: () => ipcRenderer.invoke("projects:removeMissing"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setDisableRenderThrottling: (value: boolean) => ipcRenderer.invoke("settings:setDisableRenderThrottling", value),
  detectUnityVersion: (projectPath: string) => ipcRenderer.invoke("unity:detectVersion", projectPath),
  getProjectIcon: (projectPath: string) => ipcRenderer.invoke("unity:projectIcon", projectPath),
  getVcsStatus: (projectPath: string) => ipcRenderer.invoke("vcs:status", projectPath),
  getUnityInstalls: () => ipcRenderer.invoke("unity:installs"),
  launchOrFocus: (project: ProjectEntry) => ipcRenderer.invoke("unity:launchOrFocus", project),
  launchUnityEditor: (editorPath: string) => ipcRenderer.invoke("unity:launchEditor", editorPath),
  pickDirectory: () => ipcRenderer.invoke("dialog:pickDirectory"),
  pickFile: () => ipcRenderer.invoke("dialog:pickFile"),
  cloneRepo: (repoUrl: string, targetDir: string, branch: string) =>
    ipcRenderer.invoke("repo:clone", repoUrl, targetDir, branch),
});
