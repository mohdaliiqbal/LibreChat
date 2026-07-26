import { memo, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { Spinner } from '@librechat/client';
import type { TConversation, TScheduledTask } from 'librechat-data-provider';
import { useConversationsInfiniteQuery, useScheduledTasksQuery } from '~/data-provider';
import { useLocalize, useLocalStorage } from '~/hooks';
import { cn } from '~/utils';
import Convo from './Convo';

const noop = () => {};

interface SectionProps {
  toggleNav: () => void;
  isAuthenticated: boolean;
}

/** Lazily lists one scheduled task's run conversations, newest first. */
const TaskRuns = memo(function TaskRuns({
  taskId,
  toggleNav,
}: {
  taskId: string;
  toggleNav: () => void;
}) {
  const localize = useLocalize();
  const { data, isLoading } = useConversationsInfiniteQuery(
    { scheduledTaskId: taskId, sortBy: 'createdAt', sortDirection: 'desc' },
    { staleTime: 30000, cacheTime: 300000 },
  );

  const runs = useMemo<TConversation[]>(
    () =>
      (data?.pages.flatMap((page) => page.conversations) ?? []).filter(Boolean) as TConversation[],
    [data?.pages],
  );

  if (isLoading && runs.length === 0) {
    return (
      <div className="flex justify-start py-1.5 pl-2">
        <Spinner className="h-4 w-4 text-text-secondary" />
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="py-1.5 pl-2 text-xs text-text-secondary">
        {localize('com_ui_no_task_runs')}
      </div>
    );
  }

  return (
    <div data-testid={`task-runs-${taskId}`}>
      {runs.map((convo) => (
        <Convo
          key={convo.conversationId}
          conversation={convo}
          retainView={noop}
          toggleNav={toggleNav}
          isGenerating={false}
        />
      ))}
    </div>
  );
});
TaskRuns.displayName = 'TaskRuns';

/** A single scheduled task row that expands to reveal its runs. */
const TaskItem = memo(function TaskItem({
  task,
  toggleNav,
}: {
  task: TScheduledTask;
  toggleNav: () => void;
}) {
  const localize = useLocalize();
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="list-none">
      <div className="group relative flex h-9 items-center rounded-lg text-sm text-text-primary transition-colors hover:bg-surface-active-alt">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          aria-label={task.name}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg py-1.5 pl-1.5 pr-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black dark:focus-visible:ring-white"
        >
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-text-secondary transition-transform duration-200',
              expanded && 'rotate-90',
            )}
            aria-hidden="true"
          />
          <Clock className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
          <span className="truncate">{task.name}</span>
          {task.enabled === false && (
            <span className="ml-1 shrink-0 text-xs text-text-secondary">
              {localize('com_scheduled_disabled_tag')}
            </span>
          )}
        </button>
      </div>
      {expanded && (
        <div className="pl-3">
          <TaskRuns taskId={task._id} toggleNav={toggleNav} />
        </div>
      )}
    </li>
  );
});
TaskItem.displayName = 'TaskItem';

/**
 * Collapsible "Scheduled" section in the left conversation nav. Groups scheduled
 * agent runs under their task (task → runs), mirroring the Projects section.
 * Hidden entirely when the user has no scheduled tasks.
 */
const ScheduledSection = ({ toggleNav, isAuthenticated }: SectionProps) => {
  const localize = useLocalize();
  const [isExpanded, setIsExpanded] = useLocalStorage('scheduledSectionExpanded', true);
  const { data } = useScheduledTasksQuery({ enabled: isAuthenticated });
  const tasks = data?.scheduledTasks ?? [];

  if (tasks.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col px-3 text-sm">
      <div className="flex h-8 w-full items-center gap-0.5 pr-2">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          aria-expanded={isExpanded}
          type="button"
          className="group flex min-w-0 flex-1 items-center gap-1 rounded-lg px-1 py-2 text-xs font-bold text-text-secondary outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black dark:focus-visible:ring-white"
        >
          <span className="select-none truncate">{localize('com_ui_scheduled')}</span>
          <ChevronDown
            className={cn(
              'h-3 w-3 shrink-0 transition-transform duration-200',
              isExpanded ? '' : '-rotate-90',
            )}
            aria-hidden="true"
          />
        </button>
      </div>

      {isExpanded && (
        <div className="scrollbar-gutter-stable max-h-[42vh] overflow-y-auto">
          <ul>
            {tasks.map((task) => (
              <TaskItem key={task._id} task={task} toggleNav={toggleNav} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default memo(ScheduledSection);
