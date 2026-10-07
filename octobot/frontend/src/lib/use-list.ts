"use client";

import { useEffect, useState } from "react";

export function useListFilters() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [committed, setCommitted] = useState("");
  const [status, setStatusValue] = useState("");
  const [type, setTypeValue] = useState("");
  const [catalog, setCatalogValue] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCommitted(q.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  function setStatus(value: string) {
    setStatusValue(value);
    setPage(1);
  }

  function setType(value: string) {
    setTypeValue(value);
    setPage(1);
  }

  function setCatalog(value: string) {
    setCatalogValue(value);
    setPage(1);
  }

  const params = new URLSearchParams();
  params.set("page", String(page));
  if (committed) {
    params.set("q", committed);
  }
  if (status) {
    params.set("status", status);
  }
  if (type) {
    params.set("type", type);
  }
  if (catalog) {
    params.set("catalog", catalog);
  }

  return {
    page,
    setPage,
    q,
    setQ,
    status,
    setStatus,
    type,
    setType,
    catalog,
    setCatalog,
    query: params.toString(),
    filtering: Boolean(committed || status || type || catalog),
  };
}
