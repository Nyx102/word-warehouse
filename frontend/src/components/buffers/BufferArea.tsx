import { useWorkspace, type BufferEntry } from '@/context/workspace';
import { FileBuffer } from './FileBuffer';
import { DiffBuffer } from './DiffBuffer';
import { MagitBuffer } from './MagitBuffer';
import { LogBuffer } from './LogBuffer';
import { CommitBuffer } from './CommitBuffer';
import { AlignBuffer } from './AlignBuffer';
import { CoverageBuffer } from './CoverageBuffer';
import { HelpBuffer } from './HelpBuffer';

/** Center buffer host. Every open buffer stays mounted inside a keyed wrapper;
 * only the active one is displayed (same keep-alive trick as the old .panel),
 * so editor state, search results and streams survive tab switches. */
export function BufferArea() {
  const ws = useWorkspace();

  const render = (b: BufferEntry) => {
    const d = b.desc;
    switch (d.kind) {
      case 'file':
        return <FileBuffer bufferId={b.id} path={d.path} line={d.line} gotoNonce={b.gotoNonce} />;
      case 'diff':
        return <DiffBuffer repo={d.repo} path={d.path} line={d.line} gotoNonce={b.gotoNonce} />;
      case 'magit':
        return <MagitBuffer repo={d.repo} />;
      case 'log':
        return <LogBuffer repo={d.repo} path={d.path} />;
      case 'commit':
        return <CommitBuffer repo={d.repo} rev={d.rev} />;
      case 'align':
        return <AlignBuffer />;
      case 'coverage':
        return <CoverageBuffer />;
      case 'help':
        return <HelpBuffer />;
    }
  };

  return (
    <main className="buffer-area">
      {ws.buffers.map((b) => (
        <section
          key={b.id}
          className={'buffer' + (b.id === ws.activeId ? ' active' : '')}
        >
          {render(b)}
        </section>
      ))}
      {ws.buffers.length === 0 && (
        <div className="buffer-empty">
          <p>Nothing open yet.</p>
          <p className="dim">Pick a file, search, git or flags from the rail.</p>
        </div>
      )}
    </main>
  );
}
