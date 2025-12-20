/**
 * Hook for managing project data
 */
import { useState, useEffect, useCallback } from "react";
import * as DB from "../../lib/db";

export function useProjects() {
  const [projects, setProjects] = useState<DB.Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dbProjects = DB.listProjects();
      setProjects(dbProjects);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const addProject = useCallback(
    async (input: DB.CreateProjectInput) => {
      try {
        DB.createProject(input);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  const deleteProject = useCallback(
    async (id: string) => {
      try {
        DB.deleteProject(id);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  const updateProject = useCallback(
    async (
      id: string,
      updates: Partial<DB.CreateProjectInput> & {
        current_slot?: "blue" | "green" | null;
        current_image_tag?: string | null;
      },
    ) => {
      try {
        DB.updateProject(id, updates);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  const getLatestDeployment = useCallback((projectId: string) => {
    return DB.getLatestDeployment(projectId);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    projects,
    loading,
    error,
    refresh,
    addProject,
    deleteProject,
    updateProject,
    getLatestDeployment,
  };
}
