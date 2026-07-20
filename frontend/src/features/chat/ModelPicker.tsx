import { Select } from '@/components/Select';
import type { ModelName } from '@/lib/types';

const MODELS: { id: ModelName; label: string }[] = [
  { id: 'haiku', label: 'Haiku' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'opus', label: 'Opus' },
  { id: 'default', label: 'Default' },
];

/** Model dropdown: shows the current model, click for the full list. `value` is
 * the resolved model (a thread's model, or the draft model for the next thread
 * when none is selected yet); a null thread model resolves to the app default. */
export function ModelPicker({ value, disabled, onChange }: {
  value: ModelName;
  disabled: boolean;
  onChange: (m: ModelName) => void;
}) {
  return (
    <Select
      className="model-select"
      align="right"
      value={value}
      disabled={disabled}
      onChange={(m) => onChange(m as ModelName)}
      options={MODELS.map((m) => ({ value: m.id, label: m.label }))}
      ariaLabel="Model"
      title={disabled ? 'Model locked while a turn is running' : 'Model'}
    />
  );
}
