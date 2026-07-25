import { Model } from 'mongoose';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import scheduledTaskSchema, { IScheduledTask } from '~/schema/scheduledTask';

export function createScheduledTaskModel(
  mongoose: typeof import('mongoose'),
): Model<IScheduledTask> {
  applyTenantIsolation(scheduledTaskSchema);
  return (
    mongoose.models.ScheduledTask ||
    mongoose.model<IScheduledTask>('ScheduledTask', scheduledTaskSchema)
  );
}
