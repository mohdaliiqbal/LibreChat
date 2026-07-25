import React, { useMemo, useState } from 'react';
import {
  OGDialog,
  OGDialogTemplate,
  Button,
  Label,
  Input,
  Spinner,
  useToastContext,
} from '@librechat/client';
import type { TScheduledTask, TScheduledTaskInput } from 'librechat-data-provider';
import {
  useCreateScheduledTaskMutation,
  useUpdateScheduledTaskMutation,
  useListAgentsQuery,
} from '~/data-provider';
import { useLocalize } from '~/hooks';

/** Cron presets; "custom" reveals a raw cron field. */
const CRON_PRESETS: Array<{ key: string; cron: string }> = [
  { key: 'com_scheduled_preset_hourly', cron: '0 * * * *' },
  { key: 'com_scheduled_preset_daily_9', cron: '0 9 * * *' },
  { key: 'com_scheduled_preset_weekdays_9', cron: '0 9 * * 1-5' },
  { key: 'com_scheduled_preset_monday_9', cron: '0 9 * * 1' },
];

const browserTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: TScheduledTask | null;
  children?: React.ReactNode;
  triggerRef?: React.MutableRefObject<HTMLButtonElement | null>;
}

export default function ScheduledTaskDialog({ open, onOpenChange, task, children, triggerRef }: Props) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: agentsData } = useListAgentsQuery();
  const agents = agentsData?.data ?? [];
  const isEdit = !!task;

  const [name, setName] = useState(task?.name ?? '');
  const [agentId, setAgentId] = useState(task?.agentId ?? '');
  const [prompt, setPrompt] = useState(task?.prompt ?? '');
  const [cron, setCron] = useState(task?.cron ?? '0 9 * * *');
  const [timezone, setTimezone] = useState(task?.timezone ?? browserTz());
  const [maxUsdPerDay, setMaxUsdPerDay] = useState(
    task?.guardrails?.maxUsdPerDay != null ? String(task.guardrails.maxUsdPerDay) : '',
  );
  const [maxRunsPerDay, setMaxRunsPerDay] = useState(
    task?.guardrails?.maxRunsPerDay != null ? String(task.guardrails.maxRunsPerDay) : '',
  );

  const presetValue = useMemo(() => {
    const match = CRON_PRESETS.find((p) => p.cron === cron);
    return match ? match.cron : 'custom';
  }, [cron]);

  const onDone = () => {
    onOpenChange(false);
    setTimeout(() => triggerRef?.current?.focus(), 0);
  };

  const createMutation = useCreateScheduledTaskMutation({
    onSuccess: () => {
      showToast({ message: localize('com_scheduled_saved'), status: 'success' });
      onDone();
    },
    onError: (e) => showToast({ message: e.message || localize('com_ui_error'), status: 'error' }),
  });
  const updateMutation = useUpdateScheduledTaskMutation({
    onSuccess: () => {
      showToast({ message: localize('com_scheduled_saved'), status: 'success' });
      onDone();
    },
    onError: (e) => showToast({ message: e.message || localize('com_ui_error'), status: 'error' }),
  });

  const isLoading = createMutation.isLoading || updateMutation.isLoading;
  const canSubmit = name.trim() && agentId && prompt.trim() && cron.trim();

  const handleSave = () => {
    if (!canSubmit) {
      showToast({ message: localize('com_ui_field_required'), status: 'error' });
      return;
    }
    const guardrails = {
      ...(maxUsdPerDay !== '' ? { maxUsdPerDay: Number(maxUsdPerDay) } : {}),
      ...(maxRunsPerDay !== '' ? { maxRunsPerDay: Number(maxRunsPerDay) } : {}),
    };
    const data: TScheduledTaskInput = {
      name: name.trim(),
      agentId,
      prompt: prompt.trim(),
      cron: cron.trim(),
      timezone: timezone.trim() || 'UTC',
      target: task?.target ?? 'new',
      guardrails,
    };
    if (isEdit && task) {
      updateMutation.mutate({ id: task._id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const fieldClass =
    'w-full rounded-lg border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-heavy';

  return (
    <OGDialog open={open} onOpenChange={onOpenChange} triggerRef={triggerRef}>
      {children}
      <OGDialogTemplate
        title={localize(isEdit ? 'com_scheduled_edit' : 'com_scheduled_new')}
        showCloseButton={false}
        className="w-11/12 md:max-w-lg"
        main={
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="st-name" className="text-sm font-medium text-text-primary">
                {localize('com_scheduled_name')}
              </Label>
              <Input id="st-name" value={name} onChange={(e) => setName(e.target.value)} className="w-full" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="st-agent" className="text-sm font-medium text-text-primary">
                {localize('com_scheduled_agent')}
              </Label>
              <select
                id="st-agent"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className={fieldClass}
              >
                <option value="">{localize('com_scheduled_agent_select')}</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name || a.id}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="st-prompt" className="text-sm font-medium text-text-primary">
                {localize('com_scheduled_prompt')}
              </Label>
              <textarea
                id="st-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder={localize('com_scheduled_prompt_ph')}
                className={`${fieldClass} min-h-[80px] resize-none`}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="st-preset" className="text-sm font-medium text-text-primary">
                {localize('com_scheduled_schedule')}
              </Label>
              <select
                id="st-preset"
                value={presetValue}
                onChange={(e) => e.target.value !== 'custom' && setCron(e.target.value)}
                className={fieldClass}
              >
                {CRON_PRESETS.map((p) => (
                  <option key={p.key} value={p.cron}>
                    {localize(p.key)}
                  </option>
                ))}
                <option value="custom">{localize('com_scheduled_preset_custom')}</option>
              </select>
              <Input
                aria-label={localize('com_scheduled_cron')}
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                placeholder="0 9 * * *"
                className="w-full font-mono text-xs"
              />
              <p className="text-xs text-text-secondary">{localize('com_scheduled_cron_hint')}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="st-tz" className="text-sm font-medium text-text-primary">
                  {localize('com_scheduled_timezone')}
                </Label>
                <Input id="st-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full text-xs" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="st-usd" className="text-sm font-medium text-text-primary">
                  {localize('com_scheduled_max_usd')}
                </Label>
                <Input
                  id="st-usd"
                  type="number"
                  step="0.01"
                  value={maxUsdPerDay}
                  onChange={(e) => setMaxUsdPerDay(e.target.value)}
                  placeholder="—"
                  className="w-full"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="st-runs" className="text-sm font-medium text-text-primary">
                {localize('com_scheduled_max_runs')}
              </Label>
              <Input
                id="st-runs"
                type="number"
                value={maxRunsPerDay}
                onChange={(e) => setMaxRunsPerDay(e.target.value)}
                placeholder="—"
                className="w-full"
              />
            </div>
          </div>
        }
        buttons={
          <Button
            type="button"
            variant="submit"
            onClick={handleSave}
            disabled={isLoading || !canSubmit}
            className="text-white"
          >
            {isLoading ? <Spinner className="size-4" /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
