const express = require('express');
const cron = require('node-cron');
const { logger } = require('@librechat/data-schemas');
const { requireJwtAuth } = require('~/server/middleware');
const { syncTask, removeTask, runScheduledTask } = require('~/server/services/Scheduler');
const db = require('~/models');

const router = express.Router();

router.use(requireJwtAuth);

/** Fields a client may set on create/update. */
const EDITABLE_FIELDS = [
  'name',
  'agentId',
  'prompt',
  'cron',
  'timezone',
  'target',
  'conversationId',
  'enabled',
  'guardrails',
];

function pickEditable(body) {
  const out = {};
  for (const key of EDITABLE_FIELDS) {
    if (key in body) {
      out[key] = body[key];
    }
  }
  return out;
}

/** GET / — list the caller's scheduled tasks. */
router.get('/', async (req, res) => {
  try {
    const scheduledTasks = await db.getScheduledTasksByUser(req.user.id);
    return res.status(200).json({ scheduledTasks });
  } catch (error) {
    logger.error('[scheduledTasks] list error:', error);
    return res.status(500).json({ error: 'Failed to list scheduled tasks' });
  }
});

/** POST / — create a scheduled task and register its schedule. */
router.post('/', async (req, res) => {
  try {
    const { name, agentId, prompt, cron: cronExpr } = req.body;
    if (!name || !agentId || !prompt || !cronExpr) {
      return res.status(400).json({ error: 'name, agentId, prompt, and cron are required' });
    }
    if (!cron.validate(cronExpr)) {
      return res.status(400).json({ error: 'Invalid cron expression' });
    }
    const fields = pickEditable(req.body);
    const task = await db.createScheduledTask({
      ...fields,
      enabled: fields.enabled !== false,
      user: req.user.id,
      tenantId: req.user.tenantId,
    });
    await syncTask(task);
    return res.status(201).json(task);
  } catch (error) {
    logger.error('[scheduledTasks] create error:', error);
    return res.status(500).json({ error: 'Failed to create scheduled task' });
  }
});

/** PATCH /:id — update a scheduled task (owner-scoped) and re-sync its schedule. */
router.patch('/:id', async (req, res) => {
  try {
    const update = pickEditable(req.body);
    if (update.cron && !cron.validate(update.cron)) {
      return res.status(400).json({ error: 'Invalid cron expression' });
    }
    const task = await db.updateScheduledTask(req.params.id, req.user.id, update);
    if (!task) {
      return res.status(404).json({ error: 'Scheduled task not found' });
    }
    await syncTask(task);
    return res.status(200).json(task);
  } catch (error) {
    logger.error('[scheduledTasks] update error:', error);
    return res.status(500).json({ error: 'Failed to update scheduled task' });
  }
});

/** POST /:id/run — fire a task immediately (owner-scoped); handy for testing/"Run now". */
router.post('/:id/run', async (req, res) => {
  try {
    const task = await db.getScheduledTaskById(req.params.id, req.user.id);
    if (!task) {
      return res.status(404).json({ error: 'Scheduled task not found' });
    }
    const result = await runScheduledTask(req.params.id);
    return res.status(200).json(result);
  } catch (error) {
    logger.error('[scheduledTasks] run-now error:', error);
    return res.status(500).json({ error: 'Failed to run scheduled task' });
  }
});

/** DELETE /:id — delete a scheduled task (owner-scoped) and unregister its schedule. */
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await db.deleteScheduledTask(req.params.id, req.user.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Scheduled task not found' });
    }
    await removeTask(req.params.id);
    return res.status(204).send();
  } catch (error) {
    logger.error('[scheduledTasks] delete error:', error);
    return res.status(500).json({ error: 'Failed to delete scheduled task' });
  }
});

module.exports = router;
