import {Fragment, useId, useMemo, useState, type ReactNode} from 'react';
import {ArrowDown, ChevronUp, ChevronDown, ChevronRight, Search} from '../icons';

export type AdminColumn<T> = {
  key: string;
  label: string;
  value: (row: T) => string | number;
  render?: (row: T) => ReactNode;
  numeric?: boolean;
};

/** A bounded view of authorized records, never an implied whole-business total.
 * Detail controls mount only on deliberate expansion; sorting/filtering is local.
 * No row selection, export, or bulk financial/verification mutations by default. */
export function AdminTable<T>({label, rows, columns, rowKey, rowLabel, renderDetail, toolbar,
  empty = 'No matching records.', loading = false, error = false, initialSort, searchText}: {
  label: string; rows: T[]; columns: AdminColumn<T>[]; rowKey: (row: T) => string;
  rowLabel: (row: T) => string; renderDetail?: (row: T) => ReactNode;
  toolbar?: ReactNode; empty?: string; loading?: boolean; error?: boolean;
  initialSort?: {key: string; direction: 'asc' | 'desc'};
  searchText?: (row: T) => string;
}) {
  const id = useId(), [query, setQuery] = useState(''), [page, setPage] = useState(0);
  const [size, setSize] = useState(10), [expanded, setExpanded] = useState<string | null>(null);
  const [sort, setSort] = useState(initialSort);
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const result = rows.filter(row => `${columns.map(c => c.value(row)).join(' ')} ${searchText?.(row) || ''}`.toLocaleLowerCase().includes(needle));
    const column = columns.find(c => c.key === sort?.key);
    if (column && sort) result.sort((a, b) => {
      const av = column.value(a), bv = column.value(b);
      const order = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), undefined, {numeric: true});
      return sort.direction === 'asc' ? order : -order;
    });
    return result;
  }, [rows, columns, query, sort, searchText]);
  const pages = Math.max(1, Math.ceil(shown.length / size)), current = Math.min(page, pages - 1);
  const first = current * size, visible = shown.slice(first, first + size);
  return <section className="crm-data-panel" aria-label={label}>
    <div className="crm-table-toolbar">
      <label className="crm-table-search"><span>Search {label.toLowerCase()}</span><span><Search size={18} aria-hidden="true"/><input type="search" value={query} placeholder="Search loaded records…" onChange={e => {setQuery(e.target.value); setPage(0);}}/></span></label>
      {toolbar}
      <label className="crm-page-size">Rows<select aria-label={`Rows per page for ${label}`} value={size} onChange={e => {setSize(Number(e.target.value)); setPage(0);}}>{[10,25,50].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
    </div>
    <p className="crm-scroll-hint">Scroll the table to see all columns. Review opens the full record.</p>
    <div className="crm-table-scroll" role="region" aria-label={`${label} table, scroll for all columns`} tabIndex={0}>
      <table><caption className="crm-sr-only">{label}. Search and sort apply to loaded records.</caption><thead><tr>
        {columns.map(c => <th key={c.key} scope="col" aria-sort={sort?.key === c.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'} className={c.numeric ? 'crm-numeric' : undefined}><button onClick={() => {setSort({key:c.key, direction:sort?.key === c.key && sort.direction === 'asc' ? 'desc' : 'asc'}); setPage(0);}}>{c.label}{sort?.key === c.key && (sort.direction === 'asc' ? <ChevronUp size={14} aria-hidden="true"/> : <ArrowDown size={14} aria-hidden="true"/>)}</button></th>)}
        {renderDetail && <th scope="col" className="crm-action-cell">Details</th>}
      </tr></thead><tbody>{visible.map(row => {
        const key = rowKey(row), open = expanded === key, detailId = `${id}-${encodeURIComponent(key)}`;
        return <Fragment key={key}><tr data-expanded={open}>
          {columns.map((c, i) => i === 0 ? <th key={c.key} scope="row">{c.render ? c.render(row) : c.value(row)}</th> : <td key={c.key} className={c.numeric ? 'crm-numeric' : undefined}>{c.render ? c.render(row) : c.value(row)}</td>)}
          {renderDetail && <td className="crm-action-cell"><button className="crm-row-open" aria-label={`${open ? 'Close' : 'Open'} ${rowLabel(row)}`} aria-expanded={open} aria-controls={open ? detailId : undefined} onClick={() => setExpanded(open ? null : key)}>{open ? <ChevronDown size={18} aria-hidden="true"/> : <ChevronRight size={18} aria-hidden="true"/>}<span>{open ? 'Close' : 'Review'}</span></button></td>}
        </tr>{open && renderDetail && <tr className="crm-detail-row"><td colSpan={columns.length + 1}><div id={detailId} className="crm-row-detail">{renderDetail(row)}</div></td></tr>}</Fragment>;
      })}</tbody></table>
    </div>
    {!visible.length && <p className="crm-table-empty" role="status">{loading ? 'Loading records…' : error ? 'Records unavailable. Use the retry control above.' : query ? 'No matches. Try another search.' : empty}</p>}
    <div className="crm-table-footer"><p role="status">{!rows.length&&(loading||error)?(loading?'Loading records…':'Records unavailable'):<>{shown.length ? `${first + 1}–${Math.min(first + size, shown.length)} of ${shown.length}` : '0'} {query ? 'matching' : 'loaded'} records{query && ` · ${rows.length} before search`}</>}</p><div aria-label={`${label} pages`}><button disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button><span>{current + 1} / {pages}</span><button disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>Next</button></div></div>
  </section>;
}

export function AdminStatus({value}: {value: string}) {
  const tone = /^(approved|completed|paid|captured|active|resolved|succeeded)$/.test(value) ? 'good' : /rejected|failed|disputed|suspended|overdue/.test(value) ? 'attention' : 'neutral';
  return <span className="crm-status" data-tone={tone}>{value.replaceAll('_', ' ') || 'Not recorded'}</span>;
}
