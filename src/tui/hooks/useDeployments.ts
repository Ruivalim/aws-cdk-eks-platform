/**
 * Hook for managing deployment data
 */
import { useState, useEffect, useCallback } from "react";
import * as DB from "../../lib/db";

export interface DeploymentWithProject extends DB.Deployment {
  projectName?: string;
}

export function useDeployments(projectId?: string) {
  const [deployments, setDeployments] = useState<DeploymentWithProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (projectId) {
        const dbDeployments = DB.listDeployments(projectId, 50);
        const project = DB.getProject(projectId);
        setDeployments(
          dbDeployments.map((d) => ({ ...d, projectName: project?.name })),
        );
      } else {
        // Get deployments for all projects
        const projects = DB.listProjects();
        const allDeployments: DeploymentWithProject[] = [];
        for (const project of projects) {
          const projectDeployments = DB.listDeployments(project.id, 10);
          allDeployments.push(
            ...projectDeployments.map((d) => ({
              ...d,
              projectName: project.name,
            })),
          );
        }
        // Sort by started_at desc
        allDeployments.sort(
          (a, b) =>
            new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
        );
        setDeployments(allDeployments.slice(0, 50));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const getDeploymentLogs = useCallback((deploymentId: string) => {
    return DB.getDeploymentLogs(deploymentId);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    deployments,
    loading,
    error,
    refresh,
    getDeploymentLogs,
  };
}
