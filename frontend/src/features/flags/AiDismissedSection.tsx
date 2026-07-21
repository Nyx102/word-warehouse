import { FlagCard, flagIdent } from './FlagCard';
import type { LintFlag } from '@/lib/types';

export interface ClearedFlag {
  filePath: string;
  flag: LintFlag;
}

export function AiDismissedSection({ cleared, onRestore, onOpen, busyKeys }: {
  cleared: ClearedFlag[];
  onRestore: (f: LintFlag) => void;
  onOpen: (path: string, line?: number | null) => void;
  busyKeys: Set<string>;
}) {
  if (!cleared.length) return null;
  return (
    <details className="ai-dismissed">
      <summary>AI dismissed ({cleared.length})</summary>
      <div className="ai-dismissed-list">
        {cleared.map(({ flag }) => (
          <FlagCard
            key={flagIdent(flag)}
            flag={flag}
            onOpen={onOpen}
            cleared={{ onRestore: () => onRestore(flag), busy: busyKeys.has(flagIdent(flag)) }}
          />
        ))}
      </div>
    </details>
  );
}
