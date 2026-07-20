import type { ModelName } from '@/lib/types';

const MODELS: { id: ModelName; label: string }[] = [
  { id: 'haiku', label: 'Haiku' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'opus', label: 'Opus' },
  { id: 'default', label: 'Default' },
];

/** Segmented model control. `value` is the resolved model to highlight (a
 * thread's model, or the draft model for the next thread when none is selected
 * yet); a null thread model resolves to the app default, sonnet. */
export function ModelPicker({ value, disabled, onChange }: {
  value: ModelName;
  disabled: boolean;
  onChange: (m: ModelName) => void;
}) {
  return (
    <div className="seg model-picker" role="group" aria-label="Model">
      {MODELS.map((m) => (
        <button
          key={m.id}
          className={'seg-btn' + (value === m.id ? ' active' : '')}
          disabled={disabled}
          title={disabled ? 'Model locked while a turn is running' : 'Use ' + m.label}
          onClick={() => { if (m.id !== value) onChange(m.id); }}
        >{m.label}</button>
      ))}
    </div>
  );
}
