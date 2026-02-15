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
  providerId?: "git" | "perforce" | "none" | "other";
  icon?: string;
  kind: string;
  branchOrStream: string;
  state: string;
  localChangesCount?: number;
  incomingCount?: number | null;
  outgoingCount?: number | null;
  pendingWorkItemsCount?: number | null;
  lastRefreshIso?: string;
  message?: string;
  supports?: {
    incomingOutgoing: boolean;
    pendingWorkItems: boolean;
  };
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
      saveProject: (project: ProjectEntry) => Promise<ProjectEntry[]>;
      deleteProject: (id: string) => Promise<ProjectEntry[]>;
      removeMissingProjects: () => Promise<{ removed: number; remaining: number }>;
      detectUnityVersion: (projectPath: string) => Promise<string>;
      getVcsStatus: (projectPath: string) => Promise<VcsStatus>;
      refreshVcsStatus: (projectPath: string) => Promise<VcsStatus>;
      getUnityInstalls: () => Promise<UnityInstall[]>;
      launchOrFocus: (project: ProjectEntry) => Promise<{
        ok: boolean;
        message: string;
        focused?: boolean;
        resolvedUnityExe?: string;
      }>;
      launchUnityEditor: (editorPath: string) => Promise<{ ok: boolean; message: string }>;
      pickDirectory: () => Promise<string>;
      pickFile: () => Promise<string>;
      cloneRepo: (repoUrl: string, targetDir: string, branch: string) => Promise<{ ok: boolean; message: string }>;
    };
  }
}

export {};
