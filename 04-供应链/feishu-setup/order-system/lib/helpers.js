// lib/helpers.js — 纯工具函数（零外部依赖）

export const rawVal = (v) => Array.isArray(v) ? (v[0]?.text ?? v[0] ?? "") : (v ?? "");

export const fmt = (v) => {
  if (v === "" || v === null || v === undefined) return "--";
  const n = Number(v);
  if (!isFinite(n)) return "--";
  return (n >= 0 ? "+" : "") + n.toFixed(2);
};

export const fmtAxis = (v) => (v === "" || v === null || v === undefined || Number(v) === 0) ? "--" : `${v}`;

export function parsePagination(url, defaultPageSize = 50, maxPageSize = 200) {
  const page = Math.max(1, parseInt(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(maxPageSize, Math.max(1, parseInt(url.searchParams.get("pageSize")) || defaultPageSize));
  return { page, pageSize };
}
