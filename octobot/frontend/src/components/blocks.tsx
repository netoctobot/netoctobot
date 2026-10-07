"use client";

import type { ReactNode } from "react";

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-b border-line py-5 last:border-b-0">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {hint ? <p className="text-sm text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function Fields({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`} className="min-w-0">
          <dt className="text-xs text-muted">{item.label}</dt>
          <dd className="mt-1 min-w-0">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RecordList<T>({
  rows,
  rowKey,
  columns,
}: {
  rows: T[];
  rowKey: (row: T) => string;
  columns: Array<{ header: string; render: (row: T) => ReactNode }>;
}) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border border-line md:block">
        <table className="w-full border-collapse text-start text-sm">
          <thead className="bg-paper">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.header}
                  className="px-3 py-2 text-start font-medium text-muted"
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-t border-line align-top">
                {columns.map((column) => (
                  <td key={column.header} className="px-3 py-3 break-words">
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <article key={rowKey(row)} className="rounded-lg border border-line bg-card p-3">
            <dl className="flex flex-col gap-2">
              {columns.map((column) => (
                <div key={column.header} className="min-w-0">
                  <dt className="text-xs text-muted">{column.header}</dt>
                  <dd className="mt-0.5 min-w-0">{column.render(row)}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </>
  );
}

const controlClass =
  "w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink";

export function SearchField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
      {label}
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={controlClass}
      />
    </label>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex w-full flex-col gap-1 text-sm md:w-48">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={controlClass}
      >
        {options.map((option) => (
          <option key={option.value || "all"} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
