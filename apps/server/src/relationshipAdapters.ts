import { posix } from "node:path";

export type Reference = {
  specifier: string;
  kind: "imports" | "includes" | "asset";
  line: number;
  column: number;
  candidates: string[];
};
type Adapter = {
  supports: (path: string) => boolean;
  extract: (path: string, text: string) => Reference[];
};

function references(
  text: string,
  pattern: RegExp,
  kind: Reference["kind"],
  candidates: (path: string, specifier: string) => string[],
  path: string,
): Reference[] {
  return [...text.matchAll(pattern)].map((match) => {
    const specifier = match[1];
    const at = match.index + match[0].indexOf(specifier);
    const before = text.slice(0, at);
    const line = before.split("\n").length;
    const column = at - before.lastIndexOf("\n");
    return {
      specifier,
      kind,
      line,
      column,
      candidates: candidates(path, specifier),
    };
  });
}
const relative = (
  path: string,
  specifier: string,
  suffixes: string[] = [""],
) => {
  if (/^(?:[a-z]+:|\/\/|#|data:)/i.test(specifier) || /[\\%\0]/.test(specifier))
    return [];
  const clean = specifier.split(/[?#]/, 1)[0];
  const joined = posix.normalize(
    posix.join(specifier.startsWith("/") ? "." : posix.dirname(path), clean),
  );
  if (
    !joined ||
    joined === ".." ||
    joined.startsWith("../") ||
    joined.startsWith("/")
  )
    return [];
  return suffixes.map((suffix) => joined + suffix);
};
const commentless = (text: string, pattern: RegExp) =>
  text.replace(pattern, (match) => match.replace(/[^\n]/g, " "));

const adapters: Adapter[] = [
  {
    supports: (path) => /\.java$/i.test(path),
    extract: (path, text) =>
      references(
        commentless(text, /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g),
        /^\s*import\s+(?:static\s+)?([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)\s*;/gm,
        "imports",
        (_file, spec) => {
          if (/^(?:java|javax)\./.test(spec)) return [];
          const name = spec.replaceAll(".", "/") + ".java";
          return [name, `src/${name}`, `src/main/java/${name}`];
        },
        path,
      ),
  },
  {
    supports: (path) => /\.pyi?$/i.test(path),
    extract: (path, text) =>
      references(
        commentless(text, /'''[\s\S]*?'''|"""[\s\S]*?"""|#[^\n]*/g),
        /^\s*from\s+(\.+[\w.]+)\s+import\s+/gm,
        "imports",
        (file, module) => {
          const dots = module.match(/^\.+/)![0].length;
          let base = posix.dirname(file);
          for (let i = 1; i < dots; i++) base = posix.dirname(base);
          const name = module.slice(dots).replaceAll(".", "/");
          return relative(posix.join(base, "_"), name, [".py", "/__init__.py"]);
        },
        path,
      ),
  },
  {
    supports: (path) => /\.(?:c|h|cpp|hpp|cc)$/i.test(path),
    extract: (path, text) =>
      references(
        text,
        /^\s*#\s*include\s+"([^"\n]+)"/gm,
        "includes",
        (file, spec) => relative(file, spec),
        path,
      ),
  },
  {
    supports: (path) => /\.rs$/i.test(path),
    extract: (path, text) =>
      references(
        commentless(text, /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g),
        /^\s*mod\s+([A-Za-z_]\w*)\s*;/gm,
        "imports",
        (file, name) => relative(file, name, [".rs", "/mod.rs"]),
        path,
      ),
  },
  {
    supports: (path) => /\.html?$/i.test(path),
    extract: (path, text) =>
      references(
        commentless(text, /<!--[\s\S]*?-->/g),
        /<(?:script|link|img)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi,
        "asset",
        (file, spec) => relative(file, spec),
        path,
      ),
  },
  {
    supports: (path) => /\.css$/i.test(path),
    extract: (path, text) => {
      const clean = commentless(text, /\/\*[\s\S]*?\*\//g);
      return [
        ...references(
          clean,
          /@import\s+["']([^"']+)["']/gi,
          "imports",
          (file, spec) => relative(file, spec),
          path,
        ),
        ...references(
          clean,
          /url\(\s*["']?([^\s'")]+)["']?\s*\)/gi,
          "asset",
          (file, spec) => relative(file, spec),
          path,
        ),
      ];
    },
  },
];

export function extractReferences(path: string, text: string): Reference[] {
  return (
    adapters.find((adapter) => adapter.supports(path))?.extract(path, text) ??
    []
  );
}
