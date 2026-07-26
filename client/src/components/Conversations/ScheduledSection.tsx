import { memo, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Ban, ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { Spinner } from '@librechat/client';
import type { TConversation, TScheduledTask } from 'librechat-data-provider';
import { useConversationsInfiniteQuery, useScheduledTasksQuery } from '~/data-provider';
import { useLocalize, useLocalStorage } from '~/hooks';
import { cn } from '~/utils';

/** Readable run label from the conversation's createdAt, e.g. "Jul 26, 9:00 AM". */
const formatRunTime = (value?: string | Date | null) => {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

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
  const navigate = useNavigate();
  const { conversationId: activeConversationId } = useParams();
  const [visibleCount, setVisibleCount] = useState(10);
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useConversationsInfiniteQuery(
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

  const visible = runs.slice(0, visibleCount);
  const canLoadMore = runs.length > visibleCount || hasNextPage === true;
  const onMore = () => {
    setVisibleCount((c) => c + 10);
    if (runs.length <= visibleCount + 10 && hasNextPage === true && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  return (
    <div data-testid={`task-runs-${taskId}`}>
      {visible.map((run) => {
        const isActive = run.conversationId === activeConversationId;
        return (
          <button
            key={run.conversationId}
            type="button"
            onClick={() => {
              navigate(`/c/${run.conversationId}`);
              toggleNav();
            }}
            className={cn(
              'flex w-full items-center gap-1.5 rounded-lg py-1.5 pl-2 pr-2 text-left text-xs outline-none transition-colors hover:bg-surface-active-alt focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black dark:focus-visible:ring-white',
              isActive ? 'bg-surface-active-alt text-text-primary' : 'text-text-secondary hover:text-text-primary',
            )}
          >
            <span className="truncate">{formatRunTime(run.createdAt) || run.conversationId}</span>
          </button>
        );
      })}
      {canLoadMore && (
        <button
          type="button"
          onClick={onMore}
          disabled={isFetchingNextPage}
          className="ml-1 mt-0.5 flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-text-secondary outline-none transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black dark:focus-visible:ring-white"
        >
          {isFetchingNextPage ? <Spinner className="h-3 w-3" /> : localize('com_ui_load_more')}
        </button>
      )}
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
  const skips = useMemo(
    () => (task.recentSkips ?? []).slice().reverse().slice(0, 10),
    [task.recentSkips],
  );

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
          {skips.length > 0 && (
            <div className="mt-1 border-t border-border-light pt-1">
              <div className="px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                {localize('com_scheduled_skipped')}
              </div>
              {skips.map((s, i) => (
                <div
                  key={`${s.at}-${i}`}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs text-text-secondary"
                  title={s.reason}
                >
                  <Ban className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">
                    {formatRunTime(s.at)} · {(s.reason || '').replace(/_/g, ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
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
