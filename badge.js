// badge.js — a small SVG status badge for an inspection report (for READMEs and CI).
export function badgeSvg(report) {
  const s = report.summary || { fail: 1, warn: 0 };
  const label = "agentic web";
  const value = s.fail ? `${s.fail} failing` : s.warn ? `conformant · ${s.warn} warn` : "conformant";
  const color = s.fail ? "#c0392b" : s.warn ? "#b7791f" : "#2f855a";
  const width = (t) => Math.round(t.length * 6.6 + 12);
  const lw = width(label);
  const vw = width(value);
  const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + vw}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}"><title>${esc(label)}: ${esc(value)}</title><rect width="${lw}" height="20" fill="#3a3f4b"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/><g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11"><text x="${lw / 2}" y="14" text-anchor="middle">${esc(label)}</text><text x="${lw + vw / 2}" y="14" text-anchor="middle">${esc(value)}</text></g></svg>\n`;
}
