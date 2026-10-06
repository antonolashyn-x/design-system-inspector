import { useMemo, useState } from 'react';
import type { ColorEntry, ColorRole } from '../../shared/types';
import { Copyable, Empty, HighlightButton, Search, Segmented, ShowMore, TokenList, Usage } from '../ui';

type RoleFilter = 'all' | 'text' | 'background' | 'border' | 'svg';
type SourceFilter = 'all' | 'token' | 'raw';

const ROLE_LABEL: Record<ColorRole, string> = {
  text: 'Text',
  background: 'Background',
  border: 'Border',
  fill: 'SVG fill',
  stroke: 'SVG stroke',
  outline: 'Outline',
};

const matchesRole = (c: ColorEntry, f: RoleFilter) =>
  f === 'all' || (f === 'svg' ? !!(c.roles.fill || c.roles.stroke) : !!c.roles[f as ColorRole]);

export function Colors({ colors }: { colors: ColorEntry[] }) {
  const [q, setQ] = useState('');
  const [role, setRole] = useState<RoleFilter>('all');
  const [source, setSource] = useState<SourceFilter>('all');
  const [limit, setLimit] = useState(150);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase().replace(/^#/, '');
    return colors.filter((c) => {
      if (!matchesRole(c, role)) return false;
      if (source === 'token' && !c.tokens.length) return false;
      if (source === 'raw' && c.tokens.length) return false;
      if (!query) return true;
      return (
        c.hex.toLowerCase().includes(query) || c.rgb.includes(query) || c.tokens.some((t) => t.name.toLowerCase().includes(query))
      );
    });
  }, [colors, q, role, source]);

  const count = (f: RoleFilter) => colors.filter((c) => matchesRole(c, f)).length;

  return (
    <div className="view">
      <div className="toolbar">
        <Search value={q} onChange={setQ} placeholder="Search HEX, RGB or --token" />
        <Segmented
          value={source}
          onChange={setSource}
          options={[
            { value: 'all', label: 'All' },
            { value: 'token', label: 'Tokens', count: colors.filter((c) => c.tokens.length).length },
            { value: 'raw', label: 'Raw', count: colors.filter((c) => !c.tokens.length).length },
          ]}
        />
      </div>
      <div className="toolbar">
        <Segmented
          value={role}
          onChange={setRole}
          options={[
            { value: 'all', label: 'Any use', count: colors.length },
            { value: 'text', label: 'Text', count: count('text') },
            { value: 'background', label: 'Background', count: count('background') },
            { value: 'border', label: 'Border', count: count('border') },
            { value: 'svg', label: 'SVG', count: count('svg') },
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <Empty title="No colors match">Try a different filter or search.</Empty>
      ) : (
        <div className="list">
          {filtered.slice(0, limit).map((c) => (
            <div className="row color-row" key={c.hex}>
              <span className="swatch checker">
                <span style={{ background: c.rgb }} />
              </span>
              <div className="color-values">
                <Copyable text={c.hex} className="mono strong" />
                <Copyable text={c.rgb} className="mono muted small" />
              </div>
              <div className="row-mid">
                <TokenList tokens={c.tokens} />
                <div className="roles">
                  {(Object.entries(c.roles) as [ColorRole, number][])
                    .sort((a, b) => b[1] - a[1])
                    .map(([r, n]) => (
                      <span key={r} className="role-chip" title={`${n}× as ${ROLE_LABEL[r].toLowerCase()}`}>
                        {ROLE_LABEL[r]} <b>{n}</b>
                      </span>
                    ))}
                </div>
              </div>
              <Usage count={c.count} />
              <HighlightButton id={c.key} label={c.tokens[0]?.name ?? c.hex} color={c.rgb} />
            </div>
          ))}
          <ShowMore shown={limit} total={filtered.length} onMore={() => setLimit((l) => l + 200)} />
        </div>
      )}
    </div>
  );
}
