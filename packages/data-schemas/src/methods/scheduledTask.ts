import type { Types, UpdateQuery } from 'mongoose';
import type { IScheduledTask } from '~/schema/scheduledTask';
import logger from '~/config/winston';

export type ScheduledTaskCreateData = Partial<IScheduledTask> & {
  user: string | Types.ObjectId;
  name: string;
  agentId: string;
  prompt: string;
  cron: string;
};

export type ScheduledTaskUpdateData = Partial<
  Omit<IScheduledTask, '_id' | 'user' | 'createdAt' | 'updatedAt'>
>;

export function createScheduledTaskMethods(mongoose: typeof import('mongoose')): {
  createScheduledTask: (data: ScheduledTaskCreateData) => Promise<IScheduledTask>;
  getScheduledTasksByUser: (user: string | Types.ObjectId) => Promise<IScheduledTask[]>;
  getScheduledTaskById: (
    id: string | Types.ObjectId,
    user?: string | Types.ObjectId,
  ) => Promise<IScheduledTask | null>;
  /** All enabled tasks (used by the scheduler to sync repeatable jobs on boot). */
  getEnabledScheduledTasks: () => Promise<IScheduledTask[]>;
  /** Owner-scoped update (rejects if the task isn't owned by `user`). */
  updateScheduledTask: (
    id: string | Types.ObjectId,
    user: string | Types.ObjectId,
    update: ScheduledTaskUpdateData,
  ) => Promise<IScheduledTask | null>;
  /** Unscoped field update for executor bookkeeping (runs outside a user request). */
  setScheduledTaskFields: (
    id: string | Types.ObjectId,
    update: UpdateQuery<IScheduledTask>,
  ) => Promise<IScheduledTask | null>;
  deleteScheduledTask: (
    id: string | Types.ObjectId,
    user: string | Types.ObjectId,
  ) => Promise<boolean>;
} {
  const model = () => mongoose.models.ScheduledTask;

  async function createScheduledTask(data: ScheduledTaskCreateData): Promise<IScheduledTask> {
    const doc = await model().create(data);
    return doc.toObject();
  }

  async function getScheduledTasksByUser(
    user: string | Types.ObjectId,
  ): Promise<IScheduledTask[]> {
    return model().find({ user }).sort({ createdAt: -1 }).lean<IScheduledTask[]>();
  }

  async function getScheduledTaskById(
    id: string | Types.ObjectId,
    user?: string | Types.ObjectId,
  ): Promise<IScheduledTask | null> {
    const filter = user ? { _id: id, user } : { _id: id };
    return model().findOne(filter).lean<IScheduledTask>();
  }

  async function getEnabledScheduledTasks(): Promise<IScheduledTask[]> {
    return model().find({ enabled: true }).lean<IScheduledTask[]>();
  }

  async function updateScheduledTask(
    id: string | Types.ObjectId,
    user: string | Types.ObjectId,
    update: ScheduledTaskUpdateData,
  ): Promise<IScheduledTask | null> {
    return model()
      .findOneAndUpdate({ _id: id, user }, { $set: update }, { new: true })
      .lean<IScheduledTask>();
  }

  async function setScheduledTaskFields(
    id: string | Types.ObjectId,
    update: UpdateQuery<IScheduledTask>,
  ): Promise<IScheduledTask | null> {
    try {
      return await model().findByIdAndUpdate(id, update, { new: true }).lean<IScheduledTask>();
    } catch (error) {
      logger.error('[scheduledTask] setScheduledTaskFields error:', error);
      return null;
    }
  }

  async function deleteScheduledTask(
    id: string | Types.ObjectId,
    user: string | Types.ObjectId,
  ): Promise<boolean> {
    const result = await model().deleteOne({ _id: id, user });
    return result.deletedCount > 0;
  }

  return {
    createScheduledTask,
    getScheduledTasksByUser,
    getScheduledTaskById,
    getEnabledScheduledTasks,
    updateScheduledTask,
    setScheduledTaskFields,
    deleteScheduledTask,
  };
}

export type ScheduledTaskMethods = ReturnType<typeof createScheduledTaskMethods>;
