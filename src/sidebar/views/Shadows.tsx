import type { ShadowEntry } from '../../shared/types';
import { Copyable, Empty, HighlightButton, TokenList } from '../ui';

const px = (v: string) => v.replace(/px$/, '');

export function Shadows({ shadows }: { shadows: ShadowEntry[] }) {
  if (!shadows.length)
    return (
      <div className="view">
        <Empty title="No box-shadows found">No visible element on this page uses a box-shadow.</Empty>
      </div>
    );

  return (
    <div className="view">
      <div className="shadow-grid">
        {shadows.map((s, i) => (
          <article className="card shadow-card" key={s.key}>
            <div className="shadow-stage">
              <div className="shadow-sample" style={{ boxShadow: s.value }} />
              <span className="shadow-index mono">#{i + 1}</span>
            </div>
            <div className="shadow-body">
              <div className="shadow-top">
                <span className="usage-count">{s.count.toLocaleString()}×</span>
                <span className="muted small">
                  {s.layers.length} layer{s.layers.length === 1 ? '' : 's'}
                </span>
                <span className="spacer" />
                <HighlightButton id={s.key} label={s.tokens[0]?.name ?? `Shadow #${i + 1}`} />
              </div>
              <TokenList tokens={s.tokens} />
              <table className="layers mono">
                <thead>
                  <tr>
                    <th>X</th>
                    <th>Y</th>
                    <th>Blur</th>
                    <th>Spread</th>
                    <th>Color</th>
                  </tr>
                </thead>
                <tbody>
                  {s.layers.map((l, j) => (
                    <tr key={j}>
                      <td>{px(l.x)}</td>
                      <td>{px(l.y)}</td>
                      <td>{px(l.blur)}</td>
                      <td>{px(l.spread)}</td>
                      <td>
                        <span className="layer-color">
                          <span className="mini-swatch checker">
                            <span style={{ background: l.color }} />
                          </span>
                          {l.color.replace(/\s/g, '')}
                          {l.inset && <span className="inset">inset</span>}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Copyable text={`box-shadow: ${s.value};`} className="mono small shadow-css">
                {s.value}
              </Copyable>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
