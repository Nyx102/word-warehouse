import type { ModelName, Thread } from '../types';

const MODELS: { id: ModelName; label: string }[] = [
  { id: 'haiku', label: 'Haiku' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'opus', label: 'Opus' },
  { id: 'default', label: 'Default' },
];

/** Segmented model control. model==null on the thread row means the app
 * default (sonnet), so highlight Sonnet in that case. */
export function ModelPicker({ thread, disabled, onChange }: {
  thread: Thread | null;
  disabled: boolean;
  onChange: (m: ModelName) => void;
}) {
  const selected: ModelName = thread?.model || 'sonnet';
  return (
    <div className="seg model-picker" role="group" aria-label="Model">
      {MODELS.map((m) => (
        <button
          key={m.id}
          className={'seg-btn' + (selected === m.id ? ' active' : '')}
          disabled={disabled || !thread}
          title={disabled ? 'Model locked while a turn is running' : 'Use ' + m.label + ' for this thread'}
          onClick={() => { if (m.id !== selected) onChange(m.id); }}
        >{m.label}</button>
      ))}
    </div>
  );
}
