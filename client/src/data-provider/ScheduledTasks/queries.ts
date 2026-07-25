/* Scheduled Tasks */
import { QueryKeys, dataService } from 'librechat-data-provider';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import type { UseQueryOptions, UseMutationOptions, QueryObserverResult } from '@tanstack/react-query';
import type {
  TScheduledTask,
  TScheduledTaskInput,
  TScheduledTaskRunResult,
  ScheduledTasksResponse,
} from 'librechat-data-provider';

export const useScheduledTasksQuery = (
  config?: UseQueryOptions<ScheduledTasksResponse>,
): QueryObserverResult<ScheduledTasksResponse> => {
  return useQuery<ScheduledTasksResponse>(
    [QueryKeys.scheduledTasks],
    () => dataService.getScheduledTasks(),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      ...config,
    },
  );
};

export const useCreateScheduledTaskMutation = (
  options?: UseMutationOptions<TScheduledTask, Error, TScheduledTaskInput>,
) => {
  const queryClient = useQueryClient();
  return useMutation((data: TScheduledTaskInput) => dataService.createScheduledTask(data), {
    ...options,
    onSuccess: (...params) => {
      queryClient.invalidateQueries([QueryKeys.scheduledTasks]);
      options?.onSuccess?.(...params);
    },
  });
};

export type UpdateScheduledTaskParams = { id: string; data: TScheduledTaskInput };
export const useUpdateScheduledTaskMutation = (
  options?: UseMutationOptions<TScheduledTask, Error, UpdateScheduledTaskParams>,
) => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, data }: UpdateScheduledTaskParams) => dataService.updateScheduledTask(id, data),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.scheduledTasks]);
        options?.onSuccess?.(...params);
      },
    },
  );
};

export const useDeleteScheduledTaskMutation = (
  options?: UseMutationOptions<void, Error, string>,
) => {
  const queryClient = useQueryClient();
  return useMutation((id: string) => dataService.deleteScheduledTask(id), {
    ...options,
    onSuccess: (...params) => {
      queryClient.invalidateQueries([QueryKeys.scheduledTasks]);
      options?.onSuccess?.(...params);
    },
  });
};

export const useRunScheduledTaskMutation = (
  options?: UseMutationOptions<TScheduledTaskRunResult, Error, string>,
) => {
  const queryClient = useQueryClient();
  return useMutation((id: string) => dataService.runScheduledTask(id), {
    ...options,
    onSuccess: (...params) => {
      queryClient.invalidateQueries([QueryKeys.scheduledTasks]);
      options?.onSuccess?.(...params);
    },
  });
};
