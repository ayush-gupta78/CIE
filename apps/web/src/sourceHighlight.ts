import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";

for (const [name, grammar] of Object.entries({
  typescript,
  javascript,
  python,
  css,
  xml,
  json,
  bash,
}))
  hljs.registerLanguage(name, grammar);

const languages: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  pyi: "python",
  css: "css",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  json: "json",
  sh: "bash",
};

// ponytail: cap highlighting per line; the viewer renders files over 32 KiB as plain text.
export function highlightLine(
  text: string,
  path: string,
  line: number,
): string | null {
  const language = languages[path.split(".").at(-1)?.toLowerCase() ?? ""];
  if (!language || line > 1000 || text.length > 4096) return null;
  return hljs.highlight(text, { language, ignoreIllegals: true }).value;
}
