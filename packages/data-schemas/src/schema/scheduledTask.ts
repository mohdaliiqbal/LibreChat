import mongoose, { Schema, Document, Types } from 'mongoose';

/** Per-task guardrails enforced by the scheduler before a run fires. */
export interface IScheduledTaskGuardrails {
  /** Local-time hour [0-23] to start the quiet window (no runs); paired with quietHoursEnd. */
  quietHoursStart?: number;
  /** Local-time hour [0-23] to end the quiet window. */
  quietHoursEnd?: number;
  /** Max successful runs allowed per local day. */
  maxRunsPerDay?: number;
  /** Max USD spend attributable to this task per local day. */
  maxUsdPerDay?: number;
}

export interface IScheduledTask extends Document {
  /** Owner; the run executes as this user and spends their tokenCredits. */
  user: Types.ObjectId;
  name: string;
  /** Saved agent to run (the `model` for the agent run). */
  agentId: string;
  /** Endpoint for the run; agents-only for the MVP. */
  endpoint: string;
  /** Synthetic user message injected on each fire. */
  prompt: string;
  /** Cron expression (5- or 6-field) evaluated in `timezone`. */
  cron: string;
  /** IANA timezone for the cron schedule and quiet hours (e.g. "Australia/Sydney"). */
  timezone?: string;
  /** "new" = fresh conversation per run; "reuse" = append to `conversationId`. */
  target: 'new' | 'reuse';
  /** Conversation to reuse when target = "reuse". */
  conversationId?: string;
  enabled: boolean;
  guardrails?: IScheduledTaskGuardrails;
  /** Bookkeeping written by the executor. */
  lastRunAt?: Date;
  nextRunAt?: Date;
  lastRunStatus?: 'success' | 'error' | 'skipped';
  lastRunError?: string;
  /** Conversation produced by the most recent run (deep-link from the UI). */
  lastConversationId?: string;
  /** Per-day counters, reset when `runDayKey` rolls over. */
  runsToday?: number;
  spendTodayUsd?: number;
  /** Local YYYY-MM-DD the counters above apply to. */
  runDayKey?: string;
  tenantId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const guardrailsSchema = new Schema<IScheduledTaskGuardrails>(
  {
    quietHoursStart: { type: Number, min: 0, max: 23 },
    quietHoursEnd: { type: Number, min: 0, max: 23 },
    maxRunsPerDay: { type: Number, min: 0 },
    maxUsdPerDay: { type: Number, min: 0 },
  },
  { _id: false },
);

const scheduledTaskSchema: Schema<IScheduledTask> = new Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    agentId: {
      type: String,
      required: true,
      index: true,
    },
    endpoint: {
      type: String,
      default: 'agents',
    },
    prompt: {
      type: String,
      required: true,
      maxlength: 10_000,
    },
    cron: {
      type: String,
      required: true,
    },
    timezone: {
      type: String,
    },
    target: {
      type: String,
      enum: ['new', 'reuse'],
      default: 'new',
    },
    conversationId: {
      type: String,
    },
    enabled: {
      type: Boolean,
      default: true,
      index: true,
    },
    guardrails: {
      type: guardrailsSchema,
      default: {},
    },
    lastRunAt: { type: Date },
    nextRunAt: { type: Date },
    lastRunStatus: {
      type: String,
      enum: ['success', 'error', 'skipped'],
    },
    lastRunError: { type: String },
    lastConversationId: { type: String },
    runsToday: { type: Number, default: 0 },
    spendTodayUsd: { type: Number, default: 0 },
    runDayKey: { type: String },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

scheduledTaskSchema.index({ user: 1, enabled: 1 });

export default scheduledTaskSchema;
