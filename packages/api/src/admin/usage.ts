import { logger } from '@librechat/data-schemas';
import type { IUser } from '@librechat/data-schemas';
import type { FilterQuery } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';

/** tokenCredits (and therefore `tokenValue`) are micro-dollars: 1 credit = 1e-6 USD. */
const CREDITS_PER_USD = 1_000_000;
const DEFAULT_RANGE_DAYS = 30;
/** Cap the day-by-day series so an absurd range can't allocate an unbounded array. */
const MAX_TIMESERIES_DAYS = 366;
/** Only prompt/completion transactions are spend; `credits` are admin top-ups. */
const SPEND_TOKEN_TYPES = new Set(['prompt', 'completion']);

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** The subset of a transaction ledger row the usage rollup reads. */
export interface UsageTransaction {
  user?: { toString(): string } | string | null;
  model?: string | null;
  tokenType?: string;
  tokenValue?: number;
  rawAmount?: number;
  messageId?: string | null;
  createdAt?: Date | string;
}

/** USD-per-1M-token price for a model, as stored in LibreChat's `tokenValues` registry. */
export interface ModelPrice {
  prompt: number;
  completion: number;
}

export interface AdminUsageDeps {
  /** Reads ledger rows matching a filter (injected `db.getTransactions`). */
  getTransactions: (filter: FilterQuery<Record<string, unknown>>) => Promise<UsageTransaction[]>;
  /** Resolves user display info for the aggregated user ids (injected `db.findUsers`). */
  findUsers: (
    searchCriteria: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
    options?: { limit?: number; offset?: number; sort?: Record<string, 1 | -1> },
  ) => Promise<IUser[]>;
  /** Static USD-per-1M-token registry (LibreChat `tokenValues`); surfaced so admins can see configured model cost. */
  modelPricing: Record<string, ModelPrice>;
}

export function createAdminUsageHandlers(deps: AdminUsageDeps): {
  getUsageSummary: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const { getTransactions, findUsers, modelPricing } = deps;

  /**
   * GET /api/admin/usage/summary?from=&to=
   * Aggregates the transactions ledger over a date range into spend (USD) by user,
   * by model, and per day, plus totals and the configured model-price registry.
   */
  async function getUsageSummary(req: ServerRequest, res: Response) {
    try {
      const toDate = req.query.to ? new Date(String(req.query.to)) : new Date();
      const fromDate = req.query.from
        ? new Date(String(req.query.from))
        : new Date(toDate.getTime() - DEFAULT_RANGE_DAYS * 86_400_000);

      if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
        return res.status(400).json({ error: 'Invalid from/to date' });
      }
      if (fromDate > toDate) {
        return res.status(400).json({ error: 'from must be before to' });
      }

      const txns = await getTransactions({ createdAt: { $gte: fromDate, $lte: toDate } });

      const byUserMap = new Map<
        string,
        { spendUsd: number; tokens: number; messageIds: Set<string> }
      >();
      const byModelMap = new Map<string, { spendUsd: number; tokens: number }>();
      const byDayMap = new Map<string, number>();
      const messageIds = new Set<string>();
      let totalSpendUsd = 0;
      let totalTokens = 0;

      for (const t of txns) {
        if (!t.tokenType || !SPEND_TOKEN_TYPES.has(t.tokenType)) {
          continue;
        }
        const usd = Math.abs(t.tokenValue ?? 0) / CREDITS_PER_USD;
        const tokens = Math.abs(t.rawAmount ?? 0);
        const uid = (typeof t.user === 'string' ? t.user : t.user?.toString()) ?? 'unknown';
        const model = t.model || 'unknown';

        totalSpendUsd += usd;
        totalTokens += tokens;

        const u = byUserMap.get(uid) ?? { spendUsd: 0, tokens: 0, messageIds: new Set<string>() };
        u.spendUsd += usd;
        u.tokens += tokens;
        if (t.messageId) {
          u.messageIds.add(t.messageId);
        }
        byUserMap.set(uid, u);

        const m = byModelMap.get(model) ?? { spendUsd: 0, tokens: 0 };
        m.spendUsd += usd;
        m.tokens += tokens;
        byModelMap.set(model, m);

        const key = t.createdAt ? dayKey(new Date(t.createdAt)) : 'unknown';
        byDayMap.set(key, (byDayMap.get(key) ?? 0) + usd);

        if (t.messageId) {
          messageIds.add(t.messageId);
        }
      }

      const userIds = [...byUserMap.keys()].filter((id) => id !== 'unknown');
      const users = userIds.length ? await findUsers({ _id: { $in: userIds } }, 'name email') : [];
      const userInfo = new Map(
        users.map((u) => [u._id?.toString() ?? '', { name: u.name ?? '', email: u.email ?? '' }]),
      );

      const byUser = [...byUserMap.entries()]
        .map(([id, v]) => ({
          userId: id,
          name: userInfo.get(id)?.name ?? '',
          email: userInfo.get(id)?.email ?? (id === 'unknown' ? '(unknown)' : ''),
          spendUsd: round6(v.spendUsd),
          tokens: v.tokens,
          messages: v.messageIds.size,
        }))
        .sort((a, b) => b.spendUsd - a.spendUsd);

      const byModel = [...byModelMap.entries()]
        .map(([model, v]) => ({
          model,
          spendUsd: round6(v.spendUsd),
          tokens: v.tokens,
          share: totalSpendUsd > 0 ? round6(v.spendUsd / totalSpendUsd) : 0,
        }))
        .sort((a, b) => b.spendUsd - a.spendUsd);

      const timeseries: Array<{ date: string; spendUsd: number }> = [];
      const cursor = new Date(dayKey(fromDate) + 'T00:00:00.000Z');
      const end = new Date(dayKey(toDate) + 'T00:00:00.000Z');
      let guard = 0;
      while (cursor <= end && guard < MAX_TIMESERIES_DAYS) {
        const key = dayKey(cursor);
        timeseries.push({ date: key, spendUsd: round6(byDayMap.get(key) ?? 0) });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        guard += 1;
      }

      const pricing = Object.entries(modelPricing)
        .map(([model, p]) => ({
          model,
          promptUsdPer1M: p.prompt,
          completionUsdPer1M: p.completion,
        }))
        .sort((a, b) => a.model.localeCompare(b.model));

      return res.status(200).json({
        range: { from: fromDate.toISOString(), to: toDate.toISOString() },
        currency: 'USD',
        totals: {
          spendUsd: round6(totalSpendUsd),
          tokens: totalTokens,
          messages: messageIds.size,
          activeUsers: byUser.length,
        },
        byUser,
        byModel,
        timeseries,
        modelPricing: pricing,
      });
    } catch (error) {
      logger.error('[adminUsage] getUsageSummary error:', error);
      return res.status(500).json({ error: 'Failed to build usage summary' });
    }
  }

  return { getUsageSummary };
}
