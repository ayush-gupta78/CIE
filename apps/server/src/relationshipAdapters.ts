import { posix } from "node:path";

export type Reference = {
  specifier: string;
  kind: "imports" | "includes" | "asset";
  line: number;
  column: number;
  candidates: string[];
  diagnostic?: string;
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

function cIncludes(path: string, text: string): Reference[] {
  // Keep offsets/newlines intact: evidence must point into the captured bytes.
  const comments = text.split("");
  const code = text.split("");
  let state: "code" | "line" | "block" | "quote" | "raw" = "code";
  let quote = "";
  let rawEnd = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (state === "code") {
      if (ch === "/" && (next === "/" || next === "*")) {
        state = next === "/" ? "line" : "block";
        comments[i] = comments[i + 1] = code[i] = code[i + 1] = " ";
        i++;
      } else if (ch === "R" && next === '"') {
        const opening = text.slice(i, i + 20).match(/^R"([^()\\\s]{0,16})\(/);
        if (opening) {
          rawEnd = `)${opening[1]}"`;
          state = "raw";
          for (let n = 0; n < opening[0].length; n++) code[i + n] = " ";
          i += opening[0].length - 1;
        }
      } else if (ch === '"' || ch === "'") {
        quote = ch;
        state = "quote";
        code[i] = " ";
      }
    } else if (state === "line") {
      if (ch === "\n" && text[i - 1] !== "\\") state = "code";
      else if (ch !== "\n") comments[i] = code[i] = " ";
    } else if (state === "block") {
      if (ch === "*" && next === "/") {
        comments[i] = comments[i + 1] = code[i] = code[i + 1] = " ";
        i++;
        state = "code";
      } else if (ch !== "\n") comments[i] = code[i] = " ";
    } else if (state === "raw") {
      if (text.startsWith(rawEnd, i)) {
        for (let n = 0; n < rawEnd.length; n++) code[i + n] = " ";
        i += rawEnd.length - 1;
        state = "code";
      } else if (ch !== "\n") code[i] = " ";
    } else {
      if (ch === "\\" && next !== undefined) {
        code[i] = " ";
        if (next !== "\n") code[i + 1] = " ";
        i++;
      } else {
        if (ch !== "\n") code[i] = " ";
        if (ch === quote) state = "code";
      }
    }
  }
  const masked = code.join("").split("\n");
  const visible = comments.join("").split("\n");
  const active: boolean[] = [true];
  const branches: {
    parent: boolean;
    previous: boolean | null;
    current: boolean | null;
  }[] = [];
  const diagnostics: Reference[] = [];
  const diagnostic = (line: number) =>
    diagnostics.push({
      specifier: "",
      kind: "includes",
      line,
      column: 1,
      candidates: [],
      diagnostic: "UNSUPPORTED_PREPROCESSOR_CONDITION",
    });
  let continued = false;
  for (let i = 0; i < masked.length; i++) {
    const directive = masked[i].match(
      /^\s*#\s*(if|ifdef|ifndef|elif|else|endif|include)\b/,
    );
    const line = visible[i];
    if (continued) {
      continued = /\\\s*$/.test(line);
      visible[i] = " ".repeat(line.length);
      continue;
    }
    continued = /\\\s*$/.test(line);
    if (!directive) {
      visible[i] = " ".repeat(line.length);
      continue;
    }
    const word = directive[1];
    const depth = branches.length;
    const enabled = active[depth];
    if (word === "if" || word === "ifdef" || word === "ifndef") {
      const expression = masked[i].slice(directive[0].length).trim();
      const known =
        word === "if" && !continued && /^(?:0|1)(?:\s*)$/.test(expression)
          ? expression === "1"
          : null;
      if (enabled && known === null) diagnostic(i + 1);
      branches.push({ parent: enabled, previous: known, current: known });
      active.push(enabled && known === true);
    } else if (word === "elif" || word === "else") {
      const branch = branches[depth - 1];
      if (!branch) {
        diagnostic(i + 1);
        continue;
      }
      const expression = masked[i].slice(directive[0].length).trim();
      const choice =
        word === "else"
          ? true
          : !continued && /^(?:0|1)$/.test(expression)
            ? expression === "1"
            : null;
      const current =
        branch.previous === true
          ? false
          : branch.previous === null || choice === null
            ? null
            : choice;
      if (branch.parent && current === null) diagnostic(i + 1);
      branch.current = current;
      branch.previous =
        branch.previous === true || current === true
          ? true
          : branch.previous === null || current === null
            ? null
            : false;
      active[depth] = branch.parent && current === true;
    } else if (word === "endif") {
      if (!branches.pop()) diagnostic(i + 1);
      else active.pop();
    } else if (!enabled || continued) {
      visible[i] = " ".repeat(line.length);
    }
  }
  if (branches.length) diagnostic(masked.length);
  return [
    ...references(
      visible.join("\n"),
      /^\s*#\s*include\s+"([^"\n]+)"/gm,
      "includes",
      (file, spec) => relative(file, spec),
      path,
    ),
    ...diagnostics,
  ];
}

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
    extract: cIncludes,
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
