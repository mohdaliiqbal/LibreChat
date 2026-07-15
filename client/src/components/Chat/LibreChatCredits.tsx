import { memo } from 'react';
import { useGetStartupConfig, useGetUserBalance } from '~/data-provider';
import { useAuthContext, useLocalize } from '~/hooks';

/**
 * Header chip showing the signed-in user's remaining token credits (LibreChat's
 * native per-user budget). The value is refetched after each completion by the
 * SSE hooks, so it decrements live. Admins adjust it in the admin panel
 * (Users -> Manage credits). Renders nothing when budgeting is disabled.
 */
function LibreChatCredits() {
  const localize = useLocalize();
  const { isAuthenticated } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();
  const enabled = !!isAuthenticated && !!startupConfig?.balance?.enabled;
  const { data } = useGetUserBalance({ enabled });

  if (!enabled || data?.tokenCredits == null) {
    return null;
  }

  const credits = Number(data.tokenCredits);
  const compact = credits.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const precise = credits.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div
      role="note"
      title={`${localize('com_nav_remaining_balance')}: ${precise}`}
      className="flex items-center gap-1 whitespace-nowrap rounded-full border border-border-medium px-2.5 py-1 text-xs font-medium text-text-secondary"
    >
      <span aria-hidden="true">⚡</span>
      <span>{compact}</span>
    </div>
  );
}

export default memo(LibreChatCredits);
