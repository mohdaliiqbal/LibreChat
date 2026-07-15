import { Types } from 'mongoose';
import { PrincipalType, SystemRoles } from 'librechat-data-provider';
import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import type {
  IUser,
  IConfig,
  IBalance,
  IBalanceUpdate,
  AdminUserListItem,
  AdminUserSearchResult,
  UserDeleteResult,
} from '@librechat/data-schemas';
import type { TCustomConfig } from 'librechat-data-provider';
import type { FilterQuery } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { parsePagination } from './pagination';

/** Effective balance config for a request (enabled + refill settings), as `getBalanceConfig` returns. */
export type AdminBalanceConfig = Partial<TCustomConfig['balance']> | null;

/** A `credits`-type transaction used by the admin top-up path (subset of the full `TxData`). */
export interface AdminCreditTransaction {
  user: string;
  tokenType: 'credits';
  context: string;
  rawAmount: number;
  balance?: AdminBalanceConfig;
}

const MAX_SEARCH_LENGTH = 200;

const USER_LIST_FIELDS = '_id name username email avatar role provider createdAt updatedAt';

export interface AdminUsersDeps {
  findUsers: (
    searchCriteria: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
    options?: { limit?: number; offset?: number; sort?: Record<string, 1 | -1> },
  ) => Promise<IUser[]>;
  countUsers: (filter?: FilterQuery<IUser>) => Promise<number>;
  /**
   * Thin data-layer delete — removes the User document only.
   * Full cascade of user-owned resources (conversations, messages, files, tokens, etc.)
   * is handled by `UserController.deleteUserController` in the self-delete flow.
   * This admin endpoint currently cascades Config and AclEntries.
   * A future iteration should consolidate the full cascade into a shared service function.
   */
  deleteUserById: (userId: string) => Promise<UserDeleteResult>;
  deleteConfig: (
    principalType: PrincipalType,
    principalId: string | Types.ObjectId,
  ) => Promise<IConfig | null>;
  deleteAclEntries: (filter: {
    principalType: PrincipalType;
    principalId: string | Types.ObjectId;
  }) => Promise<void>;
  /** Reads a user's balance record (tokenCredits + refill settings), or null if none exists. */
  findBalanceByUser: (user: string) => Promise<IBalance | null>;
  /** Directly sets balance fields (used by the absolute-`set` path). */
  upsertBalanceFields: (user: string, fields: IBalanceUpdate) => Promise<IBalance | null>;
  /** Records a transaction and increments the balance (used by the `add`/top-up path). */
  createTransaction: (
    txData: AdminCreditTransaction,
  ) => Promise<{ balance?: number } | undefined>;
  /** Resolves the effective balance config for the request (to know if balance is enabled). */
  resolveBalanceConfig: (req: ServerRequest) => Promise<AdminBalanceConfig>;
}

export function createAdminUsersHandlers(deps: AdminUsersDeps): {
  listUsers: (req: ServerRequest, res: Response) => Promise<Response>;
  searchUsers: (req: ServerRequest, res: Response) => Promise<Response>;
  deleteUser: (req: ServerRequest, res: Response) => Promise<Response>;
  getUserBalance: (req: ServerRequest, res: Response) => Promise<Response>;
  updateUserBalance: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const {
    findUsers,
    countUsers,
    deleteUserById,
    deleteConfig,
    deleteAclEntries,
    findBalanceByUser,
    upsertBalanceFields,
    createTransaction,
    resolveBalanceConfig,
  } = deps;

  async function listUsersHandler(req: ServerRequest, res: Response) {
    try {
      const { limit, offset } = parsePagination(req.query);
      const [users, total] = await Promise.all([
        findUsers({}, USER_LIST_FIELDS, { limit, offset, sort: { createdAt: -1 } }),
        countUsers(),
      ]);

      const mapped: AdminUserListItem[] = users.map((u) => ({
        id: u._id?.toString() ?? '',
        name: u.name ?? '',
        username: u.username ?? '',
        email: u.email ?? '',
        avatar: u.avatar ?? '',
        role: u.role ?? 'USER',
        provider: u.provider ?? 'local',
        createdAt: u.createdAt?.toISOString(),
        updatedAt: u.updatedAt?.toISOString(),
      }));

      return res.status(200).json({ users: mapped, total, limit, offset });
    } catch (error) {
      logger.error('[adminUsers] listUsers error:', error);
      return res.status(500).json({ error: 'Failed to list users' });
    }
  }

  async function searchUsersHandler(req: ServerRequest, res: Response) {
    try {
      const rawQ = req.query.q;
      const rawLimit = req.query.limit;
      const query = typeof rawQ === 'string' ? rawQ : undefined;
      const limitStr = typeof rawLimit === 'string' ? rawLimit : '20';
      const trimmed = query?.trim() ?? '';

      if (!trimmed) {
        return res.status(400).json({ error: 'Query parameter "q" is required' });
      }

      if (trimmed.length < 2) {
        return res.status(400).json({ error: 'Query must be at least 2 characters' });
      }

      if (trimmed.length > MAX_SEARCH_LENGTH) {
        return res
          .status(400)
          .json({ error: `Query must not exceed ${MAX_SEARCH_LENGTH} characters` });
      }

      const searchLimit = Math.min(Math.max(1, parseInt(limitStr, 10) || 20), 50);
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`^${escaped}`, 'i');

      const users = await findUsers(
        { $or: [{ name: regex }, { email: regex }, { username: regex }] },
        '_id name email username avatar',
        { limit: searchLimit, sort: { name: 1 } },
      );

      const results: AdminUserSearchResult[] = users.map((u) => ({
        id: u._id?.toString() ?? '',
        name: u.name ?? '',
        email: u.email ?? '',
        username: u.username,
        avatarUrl: u.avatar,
      }));

      return res
        .status(200)
        .json({ users: results, total: results.length, capped: results.length >= searchLimit });
    } catch (error) {
      logger.error('[adminUsers] searchUsers error:', error);
      return res.status(500).json({ error: 'Failed to search users' });
    }
  }

  async function deleteUserHandler(req: ServerRequest, res: Response) {
    try {
      const { id } = req.params as { id: string };

      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      const callerId = req.user?._id?.toString() ?? req.user?.id;
      if (callerId === id) {
        return res.status(403).json({ error: 'Cannot delete your own account' });
      }

      const [targetUser] = await findUsers({ _id: id }, 'role', { limit: 1 });
      if (targetUser?.role === SystemRoles.ADMIN) {
        const adminCount = await countUsers({ role: SystemRoles.ADMIN });
        if (adminCount <= 1) {
          return res.status(400).json({ error: 'Cannot delete the last admin user' });
        }
      }

      const result = await deleteUserById(id);

      if (result.deletedCount === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (targetUser?.role === SystemRoles.ADMIN) {
        const remaining = await countUsers({ role: SystemRoles.ADMIN });
        if (remaining === 0) {
          logger.error(
            `[adminUsers] CRITICAL: last admin deleted via race condition, user: ${id}. ` +
              'Manual DB intervention required to restore an ADMIN user.',
          );
        }
      }

      const objectId = new Types.ObjectId(id);
      const cleanupResults = await Promise.allSettled([
        deleteConfig(PrincipalType.USER, id),
        deleteAclEntries({ principalType: PrincipalType.USER, principalId: objectId }),
      ]);
      for (const r of cleanupResults) {
        if (r.status === 'rejected') {
          logger.error('[adminUsers] cascade cleanup failed for user:', id, r.reason);
        }
      }

      return res.status(200).json({ message: result.message || 'User deleted successfully' });
    } catch (error) {
      logger.error('[adminUsers] deleteUser error:', error);
      return res.status(500).json({ error: 'Failed to delete user' });
    }
  }

  async function getUserBalanceHandler(req: ServerRequest, res: Response) {
    try {
      const { id } = req.params as { id: string };

      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      const [targetUser] = await findUsers({ _id: id }, '_id', { limit: 1 });
      if (!targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      const [balance, balanceConfig] = await Promise.all([
        findBalanceByUser(id),
        resolveBalanceConfig(req),
      ]);

      const lastRefill =
        balance?.lastRefill instanceof Date
          ? balance.lastRefill.toISOString()
          : (balance?.lastRefill ?? null);

      return res.status(200).json({
        userId: id,
        enabled: balanceConfig?.enabled ?? false,
        tokenCredits: balance?.tokenCredits ?? 0,
        autoRefillEnabled: balance?.autoRefillEnabled ?? false,
        refillAmount: balance?.refillAmount ?? null,
        refillIntervalValue: balance?.refillIntervalValue ?? null,
        refillIntervalUnit: balance?.refillIntervalUnit ?? null,
        lastRefill,
      });
    } catch (error) {
      logger.error('[adminUsers] getUserBalance error:', error);
      return res.status(500).json({ error: 'Failed to fetch user balance' });
    }
  }

  async function updateUserBalanceHandler(req: ServerRequest, res: Response) {
    try {
      const { id } = req.params as { id: string };

      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      const body = (req.body ?? {}) as { mode?: unknown; amount?: unknown };
      const mode = body.mode;
      const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount);

      if (mode !== 'set' && mode !== 'add') {
        return res.status(400).json({ error: "Field 'mode' must be 'set' or 'add'" });
      }
      if (!Number.isFinite(amount)) {
        return res.status(400).json({ error: "Field 'amount' must be a finite number" });
      }
      if (mode === 'set' && amount < 0) {
        return res.status(400).json({ error: "Field 'amount' must be >= 0 when mode is 'set'" });
      }

      const [targetUser] = await findUsers({ _id: id }, '_id', { limit: 1 });
      if (!targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (mode === 'set') {
        const updated = await upsertBalanceFields(id, { tokenCredits: amount });
        return res.status(200).json({
          userId: id,
          mode,
          tokenCredits: updated?.tokenCredits ?? amount,
        });
      }

      const balanceConfig = await resolveBalanceConfig(req);
      if (!balanceConfig?.enabled) {
        return res.status(409).json({
          error:
            'Balance is not enabled; cannot record a credit transaction. Enable balance in config or use mode "set".',
        });
      }

      const result = await createTransaction({
        user: id,
        tokenType: 'credits',
        context: 'admin',
        rawAmount: amount,
        balance: balanceConfig,
      });

      if (!result || typeof result.balance !== 'number') {
        logger.error('[adminUsers] updateUserBalance: transaction returned no balance', { id });
        return res.status(500).json({ error: 'Failed to update user balance' });
      }

      return res.status(200).json({
        userId: id,
        mode,
        amount,
        tokenCredits: result.balance,
      });
    } catch (error) {
      logger.error('[adminUsers] updateUserBalance error:', error);
      return res.status(500).json({ error: 'Failed to update user balance' });
    }
  }

  return {
    listUsers: listUsersHandler,
    searchUsers: searchUsersHandler,
    deleteUser: deleteUserHandler,
    getUserBalance: getUserBalanceHandler,
    updateUserBalance: updateUserBalanceHandler,
  };
}
