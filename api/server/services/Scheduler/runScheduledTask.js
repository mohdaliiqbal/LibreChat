const crypto = require('crypto');
const { Constants } = require('librechat-data-provider');
const { logger } = require('@librechat/data-schemas');
const { getAppConfig } = require('~/server/services/Config');
const db = require('~/models');

const CREDITS_PER_USD = 1_000_000;

/** Local calendar day (YYYY-MM-DD) and hour [0-23] for a date in an IANA timezone. */
function localParts(date, timezone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  return {
    dayKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
  };
}

/** Whether `hour` falls inside the [start, end) quiet window (supports wrap past midnight). */
function inQuietHours(hour, start, end) {
  if (start == null || end == null || start === end) {
    return false;
  }
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** USD cost for a run's token usage, priced by the agent's underlying model (matches the ledger). */
function computeCostUsd(model, usage) {
  const prompt = Math.abs(usage?.prompt_tokens ?? 0);
  const completion = Math.abs(usage?.completion_tokens ?? 0);
  try {
    const promptRate = db.getMultiplier({ model, endpoint: 'agents', tokenType: 'prompt' });
    const completionRate = db.getMultiplier({ model, endpoint: 'agents', tokenType: 'completion' });
    return (prompt * promptRate + completion * completionRate) / CREDITS_PER_USD;
  } catch (error) {
    logger.warn('[scheduler] cost computation failed:', error?.message);
    return 0;
  }
}

/** Minimal req/res shims so the OpenAI-compat controller runs in-process (no HTTP, no SSE). */
function buildContext({ owner, appConfig, body }) {
  const req = {
    user: { id: owner._id.toString(), role: owner.role, tenantId: owner.tenantId },
    config: appConfig,
    body,
    on: () => {},
  };
  const captured = { status: 200, body: undefined };
  const res = {
    headersSent: false,
    setHeader: () => {},
    flushHeaders: () => {},
    write: () => true,
    end: () => {},
    status(code) {
      captured.status = code;
      return this;
    },
    json(payload) {
      captured.body = payload;
      return this;
    },
  };
  return { req, res, captured };
}

/**
 * Executes one scheduled task: enforces guardrails, fires the agent run via the
 * in-process OpenAI-compat controller (reusing agent init + balance spend), then
 * persists a conversation + synthetic user message + assistant reply (tagged with
 * trigger metadata) so the run is visible in chat history. Updates task bookkeeping.
 *
 * @param {string} taskId
 * @returns {Promise<{status: 'success'|'error'|'skipped', reason?: string, conversationId?: string}>}
 */
async function runScheduledTask(taskId) {
  const task = await db.getScheduledTaskById(taskId);
  if (!task) {
    logger.warn(`[scheduler] task ${taskId} not found`);
    return { status: 'error', reason: 'task_not_found' };
  }
  if (!task.enabled) {
    return { status: 'skipped', reason: 'disabled' };
  }

  const now = new Date();
  const { dayKey, hour } = localParts(now, task.timezone);
  const sameDay = task.runDayKey === dayKey;
  const runsToday = sameDay ? task.runsToday ?? 0 : 0;
  const spendToday = sameDay ? task.spendTodayUsd ?? 0 : 0;
  const guardrails = task.guardrails ?? {};

  const skip = async (reason) => {
    await db.setScheduledTaskFields(taskId, {
      $set: { lastRunAt: now, lastRunStatus: 'skipped', lastRunError: reason },
    });
    logger.info(`[scheduler] task ${taskId} skipped: ${reason}`);
    return { status: 'skipped', reason };
  };

  if (inQuietHours(hour, guardrails.quietHoursStart, guardrails.quietHoursEnd)) {
    return skip('quiet_hours');
  }
  if (guardrails.maxRunsPerDay != null && runsToday >= guardrails.maxRunsPerDay) {
    return skip('max_runs_per_day');
  }
  if (guardrails.maxUsdPerDay != null && spendToday >= guardrails.maxUsdPerDay) {
    return skip('max_usd_per_day');
  }

  const owner = await db.findUser({ _id: task.user });
  if (!owner) {
    await db.setScheduledTaskFields(taskId, {
      $set: { lastRunAt: now, lastRunStatus: 'error', lastRunError: 'owner_not_found' },
    });
    return { status: 'error', reason: 'owner_not_found' };
  }

  const agent = await db.getAgent({ id: task.agentId });
  const model = agent?.model || agent?.model_parameters?.model || task.agentId;

  const conversationId =
    task.target === 'reuse' && task.conversationId ? task.conversationId : crypto.randomUUID();

  try {
    // Lazy require to avoid any boot-time circular-dependency with the agents controller.
    const { OpenAIChatCompletionController } = require('~/server/controllers/agents/openai');
    const appConfig = await getAppConfig({ role: owner.role, tenantId: owner.tenantId });

    // Create the conversation up front: the compat controller 404s on an unknown
    // conversation_id, and this makes the run attributable to a real conversation.
    const ctx = { userId: owner._id.toString() };
    await db.saveConvo(
      ctx,
      {
        conversationId,
        endpoint: 'agents',
        agent_id: task.agentId,
        model,
        title: `⏰ ${task.name}`,
      },
      { context: 'scheduledTask' },
    );

    const { req, res, captured } = buildContext({
      owner,
      appConfig,
      body: {
        model: task.agentId,
        messages: [{ role: 'user', content: task.prompt }],
        stream: false,
        conversation_id: conversationId,
      },
    });

    await OpenAIChatCompletionController(req, res);

    if (captured.status >= 400 || !captured.body) {
      const reason =
        captured.body?.error?.message || `run_failed_status_${captured.status}`;
      await db.setScheduledTaskFields(taskId, {
        $set: { lastRunAt: now, lastRunStatus: 'error', lastRunError: reason },
      });
      return { status: 'error', reason };
    }

    const completion = captured.body;
    const assistantText = completion?.choices?.[0]?.message?.content ?? '';
    const usage = completion?.usage;
    const costUsd = computeCostUsd(model, usage);

    // Persist the messages so the run appears in the owner's chat history.
    const userMessageId = crypto.randomUUID();
    await db.saveMessage(ctx, {
      messageId: userMessageId,
      conversationId,
      parentMessageId: Constants.NO_PARENT,
      sender: 'User',
      text: task.prompt,
      isCreatedByUser: true,
      user: ctx.userId,
    });

    await db.saveMessage(ctx, {
      messageId: crypto.randomUUID(),
      conversationId,
      parentMessageId: userMessageId,
      sender: agent?.name || 'Assistant',
      text: assistantText,
      isCreatedByUser: false,
      endpoint: 'agents',
      model,
      user: ctx.userId,
      metadata: {
        usage: {
          input_tokens: usage?.prompt_tokens ?? 0,
          output_tokens: usage?.completion_tokens ?? 0,
          total_tokens: usage?.total_tokens ?? 0,
          cost: costUsd,
        },
        /** Provenance so the UI/MCP can distinguish a scheduled invocation. */
        trigger: { type: 'schedule', scheduledTaskId: taskId, name: task.name },
      },
    });

    await db.setScheduledTaskFields(taskId, {
      $set: {
        lastRunAt: now,
        lastRunStatus: 'success',
        lastRunError: null,
        lastConversationId: conversationId,
        runDayKey: dayKey,
        runsToday: runsToday + 1,
        spendTodayUsd: spendToday + costUsd,
      },
    });

    logger.info(
      `[scheduler] task ${taskId} ran: convo ${conversationId}, cost $${costUsd.toFixed(4)}`,
    );
    return { status: 'success', conversationId };
  } catch (error) {
    logger.error(`[scheduler] task ${taskId} run error:`, error);
    await db.setScheduledTaskFields(taskId, {
      $set: {
        lastRunAt: now,
        lastRunStatus: 'error',
        lastRunError: error?.message?.slice(0, 500) || 'unknown_error',
      },
    });
    return { status: 'error', reason: error?.message };
  }
}

module.exports = { runScheduledTask, inQuietHours, localParts };
