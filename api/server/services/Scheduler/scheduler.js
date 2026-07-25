const { logger } = require('@librechat/data-schemas');
const { runScheduledTask } = require('./runScheduledTask');
const db = require('~/models');

const QUEUE_NAME = 'scheduled-agents';

const redisEnabled = () =>
  /^(true|1)$/i.test(process.env.USE_REDIS || '') && !!process.env.REDIS_URI;

/**
 * In-process node-cron backend. Single-instance; schedules are reloaded from the
 * DB on boot. Suitable when Redis is not configured.
 */
function createCronBackend() {
  const cron = require('node-cron');
  const jobs = new Map();

  const fire = (taskId) => {
    runScheduledTask(taskId).catch((err) =>
      logger.error(`[scheduler] run error for ${taskId}:`, err),
    );
  };

  return {
    name: 'node-cron',
    async start() {},
    register(task) {
      const id = task._id.toString();
      if (!cron.validate(task.cron)) {
        logger.warn(`[scheduler] invalid cron "${task.cron}" for task ${id}`);
        return;
      }
      const job = cron.schedule(task.cron, () => fire(id), {
        timezone: task.timezone || 'UTC',
      });
      jobs.set(id, job);
    },
    unregister(id) {
      const job = jobs.get(id);
      if (job) {
        job.stop();
        jobs.delete(id);
      }
    },
    async stop() {
      for (const job of jobs.values()) {
        job.stop();
      }
      jobs.clear();
    },
  };
}

/**
 * BullMQ backend on Redis. Durable repeatable jobs (survive restarts) and
 * multi-instance-safe (one worker processes each fire; repeatables deduped by jobId).
 */
function createBullMQBackend() {
  const { Queue, Worker } = require('bullmq');
  const IORedis = require('ioredis');

  const connection = new IORedis(process.env.REDIS_URI, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_NAME, { connection });
  let worker = null;

  return {
    name: 'bullmq',
    async start() {
      worker = new Worker(
        QUEUE_NAME,
        async (job) => {
          await runScheduledTask(job.data.taskId);
        },
        { connection },
      );
      worker.on('failed', (job, err) =>
        logger.error(`[scheduler] bullmq job ${job?.id} failed:`, err),
      );
    },
    async register(task) {
      const id = task._id.toString();
      await this.unregister(id);
      await queue.add(
        id,
        { taskId: id },
        { repeat: { pattern: task.cron, tz: task.timezone || 'UTC' }, jobId: id },
      );
    },
    async unregister(id) {
      const repeatables = await queue.getRepeatableJobs();
      for (const r of repeatables) {
        if (r.id === id || r.name === id) {
          await queue.removeRepeatableByKey(r.key);
        }
      }
    },
    async stop() {
      if (worker) {
        await worker.close();
      }
      await queue.close();
      await connection.quit();
    },
  };
}

let backend = null;

/** Chooses the backend, starts it, and registers all enabled tasks from the DB. */
async function initScheduler() {
  if (backend) {
    return backend;
  }
  try {
    backend = redisEnabled() ? createBullMQBackend() : createCronBackend();
    await backend.start();
    const tasks = await db.getEnabledScheduledTasks();
    for (const task of tasks) {
      await backend.register(task);
    }
    logger.info(`[scheduler] started (${backend.name}) with ${tasks.length} task(s)`);
  } catch (error) {
    logger.error('[scheduler] failed to initialize:', error);
    backend = null;
  }
  return backend;
}

/** Re-register a task after create/update (no-op-safe if scheduler didn't start). */
async function syncTask(task) {
  if (!backend) {
    return;
  }
  const id = task._id.toString();
  await backend.unregister(id);
  if (task.enabled) {
    await backend.register(task);
  }
}

/** Remove a task's schedule (on delete/disable). */
async function removeTask(taskId) {
  if (!backend) {
    return;
  }
  await backend.unregister(taskId.toString());
}

async function stopScheduler() {
  if (backend) {
    await backend.stop();
    backend = null;
  }
}

module.exports = { initScheduler, syncTask, removeTask, stopScheduler };
