import { contextBridge, ipcRenderer } from "electron";
import type { ProjectEntry } from "./types";

contextBridge.exposeInMainWorld("launcherApi", {
  getProjects: () => ipcRenderer.invoke("projects:get"),
  saveProject: (project: ProjectEntry) => ipcRenderer.invoke("projects:save", project),
  deleteProject: (id: string) => ipcRenderer.invoke("projects:delete", id),
  detectUnityVersion: (projectPath: string) => ipcRenderer.invoke("unity:detectVersion", projectPath),
  getVcsStatus: (projectPath: string) => ipcRenderer.invoke("vcs:status", projectPath),
  launchOrFocus: (project: ProjectEntry) => ipcRenderer.invoke("unity:launchOrFocus", project),
  openUnityHub: () => ipcRenderer.invoke("ext:openHub"),
  openUnityDownload: () => ipcRenderer.invoke("ext:openDownload"),
  pickDirectory: () => ipcRenderer.invoke("dialog:pickDirectory"),
  pickFile: () => ipcRenderer.invoke("dialog:pickFile"),
  cloneRepo: (repoUrl: string, targetDir: string, branch: string) =>
    ipcRenderer.invoke("repo:clone", repoUrl, targetDir, branch),
  importProjectsFromUnityHub: () => ipcRenderer.invoke("unityhub:importProjects"),
});
