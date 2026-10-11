"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "./api";

export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const requestGenRef = useRef(0);

  useEffect(() => {
    setData(null);
    setError(null);
    if (path) {
      setLoading(true);
    } else {
      setLoading(false);
    }
  }, [path]);

  const reload = useCallback(async () => {
    if (!path) {
      return;
    }
    const generation = requestGenRef.current + 1;
    requestGenRef.current = generation;
    setLoading(true);
    setError(null);
    try {
      const result = await api<T>(path);
      if (generation !== requestGenRef.current) {
        return;
      }
      setData(result);
    } catch (caught) {
      if (generation !== requestGenRef.current) {
        return;
      }
      setData(null);
      setError(caught instanceof ApiError ? caught.code : "generic");
    } finally {
      if (generation === requestGenRef.current) {
        setLoading(false);
      }
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}
