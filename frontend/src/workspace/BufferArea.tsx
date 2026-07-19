import { useWorkspace, type BufferEntry } from '../app/workspace';
import { FileBuffer } from '../buffers/FileBuffer';
import { DiffBuffer } from '../buffers/DiffBuffer';
import { MagitBuffer } from '../buffers/MagitBuffer';
import { LogBuffer } from '../buffers/LogBuffer';
import { CommitBuffer } from '../buffers/CommitBuffer';
import { AlignBuffer } from '../buffers/AlignBuffer';
import { CoverageBuffer } from '../buffers/CoverageBuffer';
import { HelpBuffer } from '../buffers/HelpBuffer';

/** Center buffer host. Every open buffer stays mounted inside a keyed wrapper;
 * only the active one is displayed (same keep-alive trick as the old .panel),
 * so editor state, search results and streams survive tab switches. */
export function BufferArea() {
  const ws = useWorkspace();

  const render = (b: BufferEntry) => {
    const d = b.desc;
    switch (d.kind) {
      case 'file':
        return <FileBuffer bufferId={b.id} path={d.path} line={d.line} />;
      case 'diff':
        return <DiffBuffer repo={d.repo} path={d.path} />;
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
