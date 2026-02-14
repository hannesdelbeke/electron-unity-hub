export type ProjectEntry = {
  id: string;
  nickname: string;
  name: string;
  path: string;
  unityVersion: string;
  unityExe: string;
  lastOpenedIso: string;
};

export type VcsStatus = {
  kind: string;
  branchOrStream: string;
  state: string;
};

declare global {
  interface Window {
    launcherApi: {
      getProjects: () => Promise<ProjectEntry[]>;
      saveProject: (project: ProjectEntry) => Promise<ProjectEntry[]>;
      deleteProject: (id: string) => Promise<ProjectEntry[]>;
      detectUnityVersion: (projectPath: string) => Promise<string>;
      getVcsStatus: (projectPath: string) => Promise<VcsStatus>;
      launchOrFocus: (project: ProjectEntry) => Promise<{ ok: boolean; message: string; focused?: boolean }>;
      openUnityHub: () => Promise<void>;
      openUnityDownload: () => Promise<void>;
      pickDirectory: () => Promise<string>;
      pickFile: () => Promise<string>;
      cloneRepo: (repoUrl: string, targetDir: string, branch: string) => Promise<{ ok: boolean; message: string }>;
      importProjectsFromUnityHub: () => Promise<{ imported: number; total: number; source: string }>;
    };
  }
}

export {};
