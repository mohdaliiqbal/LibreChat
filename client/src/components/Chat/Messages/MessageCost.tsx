import { memo } from 'react';
import type { TMessage } from 'librechat-data-provider';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { formatCost } from '~/utils';

/**
 * Per-message $ cost badge for assistant messages. Reads the backend-persisted
 * USD cost off `message.metadata.usage.cost` (same field the context-cost dialog
 * uses) and formats it with `interface.currency`. Rendered only when
 * `interface.contextCost` is enabled and a cost was recorded for the message.
 */
function MessageCost({ message }: { message?: TMessage | null }) {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();

  const usage = (message?.metadata as { usage?: { cost?: number } } | undefined)?.usage;
  const cost = usage?.cost;

  if (
    startupConfig?.interface?.contextCost !== true ||
    message?.isCreatedByUser === true ||
    typeof cost !== 'number'
  ) {
    return null;
  }

  return (
    <span
      className="inline-flex select-none items-center whitespace-nowrap rounded-full border border-amber-500/60 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold leading-none text-amber-600 dark:border-amber-400/60 dark:text-amber-400"
      title={localize('com_ui_message_cost')}
      aria-label={localize('com_ui_message_cost')}
    >
      {formatCost(cost, startupConfig.interface.currency)}
    </span>
  );
}

export default memo(MessageCost);
