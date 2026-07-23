import { memo } from 'react';
import { useGetStartupConfig, useGetUserBalance } from '~/data-provider';
import { useAuthContext, useLocalize } from '~/hooks';
import { formatCost } from '~/utils';

/**
 * Header chip showing the signed-in user's remaining budget in currency ($).
 * tokenCredits are micro-dollars (1 credit = 1e-6 USD), so USD = tokenCredits / 1e6,
 * formatted via the same formatCost + interface.currency used by the chat cost dialog.
 * Refetched after each completion (SSE) so it decrements live. Admins set budgets in $
 * in the admin panel (Users -> Manage credits). Renders nothing when budgeting is disabled.
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

  const currency = startupConfig?.interface?.currency;
  const usd = Number(data.tokenCredits) / 1e6;
  const display = formatCost(usd, currency);

  return (
    <div
      role="note"
      title={`${localize('com_nav_remaining_balance')}: ${display}`}
      className="flex items-center gap-1 whitespace-nowrap rounded-full border border-border-medium px-2.5 py-1 text-xs font-medium text-text-secondary"
    >
      <span aria-hidden="true">⚡</span>
      <span>{display}</span>
    </div>
  );
}

export default memo(LibreChatCredits);
