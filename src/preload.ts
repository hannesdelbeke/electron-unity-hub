import { contextBridge, ipcRenderer } from "electron";
import type { ProjectEntry } from "./types";

contextBridge.exposeInMainWorld("launcherApi", {
  getProjects: () => ipcRenderer.invoke("projects:get"),
  saveProject: (project: ProjectEntry) => ipcRenderer.invoke("projects:save", project),
  deleteProject: (id: string) => ipcRenderer.invoke("projects:delete", id),
  removeMissingProjects: () => ipcRenderer.invoke("projects:removeMissing"),
  detectUnityVersion: (projectPath: string) => ipcRenderer.invoke("unity:detectVersion", projectPath),
  getVcsStatus: (projectPath: string) => ipcRenderer.invoke("vcs:status", projectPath),
  refreshVcsStatus: (projectPath: string) => ipcRenderer.invoke("vcs:refresh", projectPath),
  getUnityInstalls: () => ipcRenderer.invoke("unity:installs"),
  launchOrFocus: (project: ProjectEntry) => ipcRenderer.invoke("unity:launchOrFocus", project),
  launchUnityEditor: (editorPath: string) => ipcRenderer.invoke("unity:launchEditor", editorPath),
  pickDirectory: () => ipcRenderer.invoke("dialog:pickDirectory"),
  pickFile: () => ipcRenderer.invoke("dialog:pickFile"),
  cloneRepo: (repoUrl: string, targetDir: string, branch: string) =>
    ipcRenderer.invoke("repo:clone", repoUrl, targetDir, branch),
});
