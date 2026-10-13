import type { GradientEntry } from '../../shared/types';
import { Copyable, Empty, HighlightButton } from '../ui';

export function Gradients({ gradients }: { gradients: GradientEntry[] }) {
  if (!gradients.length)
    return (
      <div className="view">
        <Empty title="No gradients found">No visible element on this page uses a linear, radial or conic gradient.</Empty>
      </div>
    );

  return (
    <div className="view">
      <div className="shadow-grid">
        {gradients.map((g, i) => (
          <article className="card shadow-card" key={g.key}>
            <div className="gradient-stage" style={{ backgroundImage: g.value }}>
              <span className="shadow-index mono gradient-index">#{i + 1}</span>
            </div>
            <div className="shadow-body">
              <div className="shadow-top">
                <span className="usage-count">{g.count.toLocaleString()}×</span>
                <span className="muted small">
                  {g.repeating ? 'repeating ' : ''}
                  {g.kind} · {g.stops.length} stop{g.stops.length === 1 ? '' : 's'}
                </span>
                <span className="spacer" />
                <HighlightButton id={g.key} label={`Gradient #${i + 1}`} />
              </div>
              {g.config && <div className="mono small muted">{g.config}</div>}
              <table className="layers mono">
                <thead>
                  <tr>
                    <th>Color</th>
                    <th>Position</th>
                  </tr>
                </thead>
                <tbody>
                  {g.stops.map((s, j) => (
                    <tr key={j}>
                      <td>
                        <span className="layer-color">
                          <span className="mini-swatch checker">
                            <span style={{ background: s.color }} />
                          </span>
                          {s.color.replace(/\s/g, '')}
                        </span>
                      </td>
                      <td>{s.position || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Copyable text={`background-image: ${g.value};`} className="mono small shadow-css">
                {g.value}
              </Copyable>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
