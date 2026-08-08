import type { Key, ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, MoreIcon } from "./icons";
import type { EntityColumn } from "./types";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export interface EntityTableProps<T> {
  caption: string;
  columns: EntityColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => Key;
  loading?: boolean;
  error?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  sort?: { key: string; direction: "asc" | "desc" };
  rowHref?: (row: T) => string;
  rowLabel?: (row: T) => string;
  renderActions?: (row: T) => ReactNode;
  className?: string;
}

function CellValue<T>({ column, row }: { column: EntityColumn<T>; row: T }) {
  if (column.render) return column.render(row);
  if (column.accessor) {
    const value = row[column.accessor];
    if (value === null || value === undefined) return <span aria-label="Not provided">—</span>;
    return <>{String(value)}</>;
  }
  return null;
}

export function EntityTable<T>({ caption, columns, rows, getRowKey, loading = false, error, emptyTitle = "No records found", emptyDescription = "Try changing your search or filters.", sort, rowHref, rowLabel, renderActions, className }: EntityTableProps<T>) {
  const visibleColumns = columns.filter((column) => column.visible !== false);
  const columnCount = visibleColumns.length + (renderActions ? 1 : 0);
  return (
    <div className={cx("entity-table overflow-x-auto rounded-xl border border-slate-200 bg-white", className)}>
      <table className="w-full min-w-[680px] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
          <tr>
            {visibleColumns.map((column) => {
              const isSorted = sort?.key === column.key;
              const nextDirection = isSorted && sort.direction === "asc" ? "desc" : "asc";
              const header = <span className="inline-flex items-center gap-1.5">{column.header}{isSorted ? (sort.direction === "asc" ? <ArrowUpIcon className="h-3.5 w-3.5" /> : <ArrowDownIcon className="h-3.5 w-3.5" />) : null}</span>;
              return (
                <th key={column.key} scope="col" aria-sort={isSorted ? (sort.direction === "asc" ? "ascending" : "descending") : column.sortable ? "none" : undefined} className={cx("whitespace-nowrap border-b border-slate-200 px-4 py-3", column.align === "end" && "text-right", column.align === "center" && "text-center", column.headerClassName)}>
                  {column.sortable && column.sortHref ? <a className="rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" href={column.sortHref(nextDirection)} aria-label={`Sort by ${column.header}, ${nextDirection}ending`}>{header}</a> : header}
                </th>
              );
            })}
            {renderActions ? <th scope="col" className="w-14 border-b border-slate-200 px-3 py-3 text-right"><span className="sr-only">Actions</span></th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading ? <LoadingRows columns={columnCount} /> : null}
          {!loading && error ? <tr><td colSpan={columnCount} className="px-4 py-12 text-center"><p role="alert" className="font-semibold text-red-800">Couldn’t load {caption.toLowerCase()}</p><p className="mt-1 text-sm text-slate-500">{error}</p></td></tr> : null}
          {!loading && !error && !rows.length ? <tr><td colSpan={columnCount} className="px-4 py-12 text-center"><p className="font-semibold text-slate-900">{emptyTitle}</p><p className="mt-1 text-sm text-slate-500">{emptyDescription}</p></td></tr> : null}
          {!loading && !error ? rows.map((row) => {
            const key = getRowKey(row);
            return (
              <tr key={key} className="entity-table__row bg-white transition-colors hover:bg-slate-50 focus-within:bg-slate-50">
                {visibleColumns.map((column, index) => (
                  <td key={column.key} className={cx("px-4 py-3 align-middle text-slate-700", column.align === "end" && "text-right tabular-nums", column.align === "center" && "text-center", column.cellClassName)}>
                    {index === 0 && rowHref ? <a href={rowHref(row)} className="font-semibold text-slate-950 underline-offset-2 hover:text-teal-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" aria-label={rowLabel?.(row)}><CellValue column={column} row={row} /></a> : <CellValue column={column} row={row} />}
                  </td>
                ))}
                {renderActions ? <td className="px-3 py-3 text-right"><div className="entity-table__actions inline-flex min-h-9 items-center">{renderActions(row)}</div></td> : null}
              </tr>
            );
          }) : null}
        </tbody>
      </table>
    </div>
  );
}

function LoadingRows({ columns }: { columns: number }) {
  return <>{[0, 1, 2, 3].map((row) => <tr key={row} aria-hidden="true">{Array.from({ length: columns }, (_, column) => <td key={column} className="px-4 py-4"><span className="block h-4 animate-pulse rounded bg-slate-100" /></td>)}</tr>)}</>;
}

export function RowActionsButton({ label = "Open row actions", onClick }: { label?: string; onClick?: () => void }) {
  return <button type="button" onClick={onClick} className="inline-grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" aria-label={label}><MoreIcon className="h-5 w-5" /></button>;
}
