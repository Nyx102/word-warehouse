import { IconChevronDown } from '@/components/layout/icons';
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
    <span className="model-select-wrap">
      <select
        className="model-select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as ModelName)}
        aria-label="Model"
        title={disabled ? 'Model locked while a turn is running' : 'Model'}
      >
        {MODELS.map((m) => (
          <option key={m.id} value={m.id}>{m.label}</option>
        ))}
      </select>
      <span className="model-caret"><IconChevronDown /></span>
    </span>
  );
}
