import { Types } from 'mongoose';
import type { IUser } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { AdminUsageDeps, UsageTransaction } from './usage';
import { createAdminUsageHandlers } from './usage';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const userA = new Types.ObjectId();
const userB = new Types.ObjectId();

function mockUser(id: Types.ObjectId, overrides: Partial<IUser> = {}): IUser {
  return {
    _id: id,
    name: `User ${id.toString().slice(-4)}`,
    email: `${id.toString().slice(-4)}@example.com`,
    role: 'USER',
    provider: 'local',
    ...overrides,
  } as IUser;
}

function createReqRes(query: Record<string, string> = {}) {
  const req = { params: {}, query, body: {}, user: { _id: userA, role: 'admin' } } as unknown as ServerRequest;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { req, res, status, json };
}

function createDeps(overrides: Partial<AdminUsageDeps> = {}): AdminUsageDeps {
  return {
    getTransactions: jest.fn().mockResolvedValue([]),
    findUsers: jest.fn().mockResolvedValue([]),
    modelPricing: { 'claude-opus-4-8': { prompt: 5, completion: 25 } },
    ...overrides,
  };
}

/** tokenValue is micro-dollars (negative = spend): -5_000_000 => $5.00 spend. */
function tx(overrides: Partial<UsageTransaction> = {}): UsageTransaction {
  return {
    user: userA,
    model: 'claude-opus-4-8',
    tokenType: 'completion',
    tokenValue: -1_000_000,
    rawAmount: -40_000,
    messageId: new Types.ObjectId().toString(),
    createdAt: new Date('2026-07-10T12:00:00.000Z'),
    ...overrides,
  };
}

describe('createAdminUsageHandlers.getUsageSummary', () => {
  beforeEach(() => jest.clearAllMocks());

  it('aggregates spend (USD) by user, by model, and totals', async () => {
    const deps = createDeps({
      getTransactions: jest.fn().mockResolvedValue([
        tx({ user: userA, model: 'claude-opus-4-8', tokenValue: -2_000_000, rawAmount: -50_000 }),
        tx({ user: userB, model: 'gpt-4o', tokenValue: -500_000, rawAmount: -10_000 }),
      ]),
      findUsers: jest.fn().mockResolvedValue([mockUser(userA), mockUser(userB)]),
    });
    const { req, res, status, json } = createReqRes();

    await createAdminUsageHandlers(deps).getUsageSummary(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const body = json.mock.calls[0][0];
    expect(body.currency).toBe('USD');
    expect(body.totals.spendUsd).toBeCloseTo(2.5, 6);
    expect(body.totals.tokens).toBe(60_000);
    expect(body.totals.activeUsers).toBe(2);
    // sorted by spend desc
    expect(body.byUser[0].userId).toBe(userA.toString());
    expect(body.byUser[0].spendUsd).toBeCloseTo(2, 6);
    expect(body.byModel[0].model).toBe('claude-opus-4-8');
    expect(body.byModel[0].share).toBeCloseTo(0.8, 6);
  });

  it('ignores non-spend (credits top-up) transactions', async () => {
    const deps = createDeps({
      getTransactions: jest.fn().mockResolvedValue([
        tx({ tokenValue: -1_000_000, rawAmount: -20_000 }),
        // admin top-up: must not count as spend
        { user: userA, tokenType: 'credits', tokenValue: 1_000_000, rawAmount: 1_000_000, createdAt: new Date('2026-07-10') },
      ]),
      findUsers: jest.fn().mockResolvedValue([mockUser(userA)]),
    });
    const { req, res, json } = createReqRes();

    await createAdminUsageHandlers(deps).getUsageSummary(req, res);

    expect(json.mock.calls[0][0].totals.spendUsd).toBeCloseTo(1, 6);
  });

  it('counts distinct messages across prompt+completion rows', async () => {
    const mid = new Types.ObjectId().toString();
    const deps = createDeps({
      getTransactions: jest.fn().mockResolvedValue([
        tx({ tokenType: 'prompt', tokenValue: -100_000, messageId: mid }),
        tx({ tokenType: 'completion', tokenValue: -900_000, messageId: mid }),
      ]),
      findUsers: jest.fn().mockResolvedValue([mockUser(userA)]),
    });
    const { req, res, json } = createReqRes();

    await createAdminUsageHandlers(deps).getUsageSummary(req, res);
    expect(json.mock.calls[0][0].totals.messages).toBe(1);
  });

  it('surfaces the configured model-price registry', async () => {
    const deps = createDeps({ modelPricing: { 'gpt-4o': { prompt: 2.5, completion: 10 } } });
    const { req, res, json } = createReqRes();

    await createAdminUsageHandlers(deps).getUsageSummary(req, res);
    expect(json.mock.calls[0][0].modelPricing).toEqual([
      { model: 'gpt-4o', promptUsdPer1M: 2.5, completionUsdPer1M: 10 },
    ]);
  });

  it('filters transactions by the requested date range', async () => {
    const getTransactions = jest.fn().mockResolvedValue([]);
    const { req, res } = createReqRes({ from: '2026-07-01', to: '2026-07-15' });

    await createAdminUsageHandlers(createDeps({ getTransactions })).getUsageSummary(req, res);

    const filter = getTransactions.mock.calls[0][0];
    expect(filter.createdAt.$gte).toEqual(new Date('2026-07-01'));
    expect(filter.createdAt.$lte).toEqual(new Date('2026-07-15'));
  });

  it('rejects an invalid date range with 400', async () => {
    const { req, res, status } = createReqRes({ from: 'not-a-date' });
    await createAdminUsageHandlers(createDeps()).getUsageSummary(req, res);
    expect(status).toHaveBeenCalledWith(400);
  });

  it('returns 500 when the data layer throws', async () => {
    const deps = createDeps({ getTransactions: jest.fn().mockRejectedValue(new Error('db down')) });
    const { req, res, status } = createReqRes();
    await createAdminUsageHandlers(deps).getUsageSummary(req, res);
    expect(status).toHaveBeenCalledWith(500);
  });

  it('returns per-day activity with the dominant model + totals', async () => {
    const day = new Date();
    const deps = createDeps({
      getTransactions: jest.fn().mockResolvedValue([
        tx({ tokenType: 'completion', model: 'claude-opus-4-8', tokenValue: -100, rawAmount: -100, createdAt: day }),
        tx({ tokenType: 'prompt', model: 'gpt-4o', tokenValue: -30, rawAmount: -30, createdAt: day }),
      ]),
      findUsers: jest.fn().mockResolvedValue([mockUser(userA)]),
    });
    const { req, res, json } = createReqRes();
    await createAdminUsageHandlers(deps).getUsageSummary(req, res);
    const body = json.mock.calls[0][0];
    const entry = body.activity.find((a: { date: string }) => a.date === day.toISOString().slice(0, 10));
    expect(entry).toBeTruthy();
    expect(entry.tokens).toBe(130);
    expect(entry.model).toBe('claude-opus-4-8');
    expect(body.activityTotals.activeDays).toBeGreaterThanOrEqual(1);
    expect(body.activityTotals.lifetimeTokens).toBe(130);
  });
});
