import { useState } from 'react';
import { Plus, Play, Pencil, Trash2 } from 'lucide-react';
import { Button, Spinner, Switch, useToastContext, OGDialogTrigger } from '@librechat/client';
import type { TScheduledTask } from 'librechat-data-provider';
import {
  useScheduledTasksQuery,
  useDeleteScheduledTaskMutation,
  useRunScheduledTaskMutation,
  useUpdateScheduledTaskMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';
import ScheduledTaskDialog from './ScheduledTaskDialog';

const STATUS_COLORS: Record<string, string> = {
  success: 'text-green-600 dark:text-green-400',
  error: 'text-red-600 dark:text-red-400',
  skipped: 'text-amber-600 dark:text-amber-400',
};

function TaskRow({ task }: { task: TScheduledTask }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [editOpen, setEditOpen] = useState(false);

  const runMutation = useRunScheduledTaskMutation({
    onSuccess: (r) =>
      showToast({
        message:
          r.status === 'success'
            ? localize('com_scheduled_run_ok')
            : localize('com_scheduled_run_skip', { reason: r.reason ?? '' }),
        status: r.status === 'error' ? 'error' : 'success',
      }),
    onError: (e) => showToast({ message: e.message, status: 'error' }),
  });
  const deleteMutation = useDeleteScheduledTaskMutation({
    onSuccess: () => showToast({ message: localize('com_scheduled_deleted'), status: 'success' }),
  });
  const updateMutation = useUpdateScheduledTaskMutation();

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-light p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-text-primary">{task.name}</div>
          <div className="truncate font-mono text-xs text-text-secondary">
            {task.cron} · {task.timezone || 'UTC'}
          </div>
        </div>
        <Switch
          checked={task.enabled}
          onCheckedChange={(checked) =>
            updateMutation.mutate({ id: task._id, data: { enabled: checked } })
          }
          aria-label={localize('com_scheduled_enabled')}
        />
      </div>

      <div className="flex items-center gap-2 text-xs">
        {task.lastRunStatus ? (
          <span className={STATUS_COLORS[task.lastRunStatus] ?? 'text-text-secondary'}>
            {localize('com_scheduled_last_run')}: {task.lastRunStatus}
          </span>
        ) : (
          <span className="text-text-secondary">{localize('com_scheduled_never_run')}</span>
        )}
        {typeof task.spendTodayUsd === 'number' && task.spendTodayUsd > 0 && (
          <span className="text-text-secondary">· ${task.spendTodayUsd.toFixed(4)}</span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          className="h-7 px-2 text-xs"
          disabled={runMutation.isLoading}
          onClick={() => runMutation.mutate(task._id)}
        >
          {runMutation.isLoading ? <Spinner className="size-3" /> : <Play className="size-3" />}
          <span className="ml-1">{localize('com_scheduled_run_now')}</span>
        </Button>
        <Button variant="outline" className="h-7 px-2 text-xs" onClick={() => setEditOpen(true)}>
          <Pencil className="size-3" />
        </Button>
        <Button
          variant="outline"
          className="h-7 px-2 text-xs"
          disabled={deleteMutation.isLoading}
          onClick={() => deleteMutation.mutate(task._id)}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>

      <ScheduledTaskDialog open={editOpen} onOpenChange={setEditOpen} task={task} />
    </div>
  );
}

export default function ScheduledPanel() {
  const localize = useLocalize();
  const { data, isLoading } = useScheduledTasksQuery();
  const [createOpen, setCreateOpen] = useState(false);
  const tasks = data?.scheduledTasks ?? [];

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">{localize('com_sidepanel_scheduled')}</h3>
        <ScheduledTaskDialog open={createOpen} onOpenChange={setCreateOpen}>
          <OGDialogTrigger asChild>
            <Button variant="outline" className="h-7 px-2 text-xs" onClick={() => setCreateOpen(true)}>
              <Plus className="size-3" />
              <span className="ml-1">{localize('com_scheduled_new')}</span>
            </Button>
          </OGDialogTrigger>
        </ScheduledTaskDialog>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="size-5" />
        </div>
      ) : tasks.length === 0 ? (
        <p className="mt-4 text-center text-xs text-text-secondary">{localize('com_scheduled_empty')}</p>
      ) : (
        <div className="flex flex-col gap-2 overflow-y-auto">
          {tasks.map((task) => (
            <TaskRow key={task._id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}
