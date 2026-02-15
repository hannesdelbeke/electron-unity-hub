export type ProjectEntry = {
  id: string;
  nickname: string;
  name: string;
  path: string;
  unityVersion: string;
  unityExe: string;
  lastOpenedIso: string;
  autoGetLatest?: boolean;
  cloudRepo?: string;
  cloneUrl?: string;
  repoSizeBytes?: number;
};

export type VcsStatus = {
  kind: string;
  branchOrStream: string;
  state: string;
  localChangesCount: number;
  incomingCount: number;
  outgoingCount: number;
  conflictCount: number;
  infoMessage?: string;
};

export type UnityInstall = {
  version: string;
  path: string;
  source: string;
  exists: boolean;
};

declare global {
  interface Window {
    launcherApi: {
      getProjects: () => Promise<ProjectEntry[]>;
      getCloudProjects: () => Promise<ProjectEntry[]>;
      saveProject: (project: ProjectEntry) => Promise<ProjectEntry[]>;
      deleteProject: (id: string) => Promise<ProjectEntry[]>;
      deleteCloudProject: (id: string) => Promise<ProjectEntry[]>;
      cloneCloudProject: (projectId: string, parentDir: string) => Promise<{ ok: boolean; message: string; projects: ProjectEntry[] }>;
      removeMissingProjects: () => Promise<{ removed: number; remaining: number }>;
      syncFromUnityHub: () => Promise<{ ok: boolean; message: string; added: number }>;
      getSettings: () => Promise<{ disableRenderThrottling: boolean }>;
      setDisableRenderThrottling: (value: boolean) => Promise<{ ok: boolean }>;
      detectUnityVersion: (projectPath: string) => Promise<string>;
      getProjectIcon: (projectPath: string) => Promise<string>;
      getProjectRemoteUrl: (projectPath: string) => Promise<string>;
      getProjectLastCommitIso: (projectPath: string) => Promise<string>;
      getProjectSizeBytes: (projectPath: string) => Promise<number>;
      getVcsStatus: (projectPath: string) => Promise<VcsStatus>;
      gitCommitPush: (projectPath: string) => Promise<{ ok: boolean; message: string; conflict?: boolean }>;
      gitPull: (projectPath: string) => Promise<{ ok: boolean; message: string; conflict?: boolean }>;
      isProjectOpen: (projectPath: string) => Promise<boolean>;
      getUnityInstalls: () => Promise<UnityInstall[]>;
      launchOrFocus: (project: ProjectEntry) => Promise<{
        ok: boolean;
        message: string;
        focused?: boolean;
        resolvedUnityExe?: string;
      }>;
      launchUnityEditor: (editorPath: string) => Promise<{ ok: boolean; message: string }>;
      browseTo: (targetPath: string) => Promise<{ ok: boolean; message: string }>;
      openExternalUrl: (targetUrl: string) => Promise<{ ok: boolean; message: string }>;
      pickDirectory: () => Promise<string>;
      pickFile: () => Promise<string>;
      cloneRepo: (repoUrl: string, targetDir: string, branch: string) => Promise<{ ok: boolean; message: string }>;
      getGitHubAuthStatus: () => Promise<{
        ghInstalled: boolean;
        ghAuthenticated: boolean;
        connected: boolean;
        login: string;
        source: "gh" | "token" | "none";
        installHint: string;
        installUrl: string;
        message: string;
      }>;
      setGitHubToken: (token: string) => Promise<{ ok: boolean; message: string }>;
      clearGitHubToken: () => Promise<{ ok: boolean }>;
      discoverCloudProjects: () => Promise<{ ok: boolean; message: string; projects: ProjectEntry[] }>;
      getGhStatus: () => Promise<{
        installed: boolean;
        authenticated: boolean;
        login: string;
        installHint: string;
        installUrl: string;
        message: string;
      }>;
      openGhInstall: () => Promise<{ ok: boolean; message: string; url: string }>;
    };
  }
}

export {};


