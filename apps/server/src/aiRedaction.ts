import ts from "typescript";

const MASK = "[redacted]";
const OMIT = "[omitted: private key]";

// Match credential-bearing suffixes across camel/Pascal/snake/kebab and prefixed names.
// A hash/identifier such as passwordHash is not a credential assignment.
const credentialName = (name: string) =>
  /(?:secret(?:[_-]?access[_-]?key)?|password|(?:access|refresh)[_-]?token|token|api[_-]?key|private[_-]?key)$/i.test(
    name,
  );

/** Redact source excerpts before sending them outside the server. Line positions stay stable. */
export function redactEvidence(text: string): {
  text: string;
  redactedCount: number;
  omittedCount: number;
  warnings: string[];
} {
  // Bound work on oversized source; keep the line map even when omitting it.
  // ponytail: lexical regexes have a fixed 4096-character work ceiling;
  // replace them with a linear parser before retaining larger excerpts.
  if (text.length > 4096) {
    const lines = text.split("\n");
    return {
      text: lines.map(() => "[omitted: oversized evidence]").join("\n"),
      redactedCount: 0,
      omittedCount: lines.length,
      warnings: ["Oversized evidence was omitted."],
    };
  }
  let redactedCount = 0;
  let omittedCount = 0;
  let inKey = false;

  // ponytail: lexical screening is conservative, not a full JS parser; use a
  // language parser if retaining ambiguous expressions becomes important.
  const keys =
    /(?:\[[^\n]*?\]|\[[^\]\n]*?(?=\s*:)|"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|(?:[\w$-]|\\u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]+\}))+?)((?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*(?::|(?:\*\*|&&|\|\||\?\?|>>>|<<|>>|[!?+\-*/%&|^])?=))/g;
  let match: RegExpExecArray | null;
  let screened = "";
  let cursor = 0;
  while ((match = keys.exec(text))) {
    const raw = match[0].slice(0, -match[1].length);
    const name = raw
      .replace(/^["']|["']$/g, "")
      .replace(
        /\\u(?:([0-9a-fA-F]{4})|\{([0-9a-fA-F]+)\})/g,
        (_m, a: string, b: string) => {
          const value = parseInt(a || b, 16);
          return value <= 0x10ffff ? String.fromCodePoint(value) : "";
        },
      )
      .replace(/\\x([0-9a-fA-F]{2})/g, (_m, hex: string) =>
        String.fromCharCode(parseInt(hex, 16)),
      )
      .replace(/\\(["'\\])/g, "$1");
    const plural =
      /(?:credentials|api[_-]?keys|secrets|passwords|tokens)$/i.test(name);
    const computed = raw.startsWith("[");
    let ambiguousName = raw.startsWith("'") && raw.includes("\\");
    if (raw.startsWith('"') && raw.includes("\\")) {
      try {
        JSON.parse(raw);
      } catch {
        ambiguousName = true;
      }
    }
    if (!computed && !ambiguousName && !credentialName(name) && !plural)
      continue;
    let start = keys.lastIndex;
    // Comments in the gap can contain credentials, so include them in the mask.
    while (start < text.length) {
      if (/\s/.test(text[start])) {
        start++;
        continue;
      }
      if (text.startsWith("//", start)) {
        const end = text.indexOf("\n", start);
        start = end < 0 ? text.length : end + 1;
        continue;
      }
      if (text.startsWith("/*", start)) {
        const end = text.indexOf("*/", start + 2);
        start = end < 0 ? text.length : end + 2;
        continue;
      }
      break;
    }
    const first = text[start];
    // Recognize actual TS declarations, not values coincidentally named "string".
    let typeDeclaration = false;
    if (
      match[1].endsWith(":") &&
      /^(?:string|number|boolean|unknown|any)\b/.test(text.slice(start))
    ) {
      const original = ts.createSourceFile(
        "evidence.ts",
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const visit = (node: ts.Node) => {
        if (
          (ts.isParameter(node) ||
            ts.isPropertySignature(node) ||
            ts.isPropertyDeclaration(node)) &&
          !("initializer" in node && node.initializer) &&
          node.type?.getStart(original) === start &&
          /^(?:string|number|boolean|unknown|any)$/.test(
            node.type.getText(original),
          )
        ) {
          typeDeclaration = true;
        }
        ts.forEachChild(node, visit);
      };
      visit(original);
    }
    if (typeDeclaration) continue;
    // ponytail: parse bounded assignment expressions; mixed-language evidence
    // still needs a language-aware parser to distinguish all syntactic contexts.
    const queryParameter = /[?&/]$/.test(text.slice(0, match.index));
    if (!queryParameter && first && !/[|>]/.test(first)) {
      const source = ts.createSourceFile(
        "evidence.ts",
        `const __credential = ${text.slice(start)}`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const statement = source.statements[0];
      const value =
        statement && ts.isVariableStatement(statement)
          ? statement.declarationList.declarations[0]?.initializer
          : undefined;
      const env =
        value &&
        /^process\.env(?:\.[A-Za-z_]\w*|\[(?:"[^"\n]+"|'[^'\n]+')\])$/.test(
          value.getText(source),
        );
      const remainder = value
        ? text.slice(start + value.end - "const __credential = ".length)
        : "";
      const complete = /^(?:[ \t\r]|\/\*[^\n]*?\*\/)*(?:$|[\n,;}\]]|\/\/)/.test(
        remainder,
      );
      const simple =
        value &&
        complete &&
        (ts.isStringLiteral(value) ||
          ts.isNoSubstitutionTemplateLiteral(value) ||
          ts.isNumericLiteral(value) ||
          value.kind === ts.SyntaxKind.TrueKeyword ||
          value.kind === ts.SyntaxKind.FalseKeyword ||
          value.kind === ts.SyntaxKind.NullKeyword ||
          env ||
          (match[1].endsWith(":") &&
            (ts.isArrayLiteralExpression(value) ||
              ts.isObjectLiteralExpression(value))));
      if (!simple) {
        const lines = text.split("\n");
        return {
          text: lines.map(() => "[omitted: ambiguous credential]").join("\n"),
          redactedCount: 0,
          omittedCount: lines.length,
          warnings: ["Ambiguous credential evidence was omitted."],
        };
      }
    }
    // ponytail: indirect values omit the whole bounded input; a language-aware
    // data-flow analysis is needed to retain unrelated evidence safely.
    const reference = text.slice(start).match(/^[A-Za-z_$][\w$]*/)?.[0];
    const expression = text.slice(start).split(/[;\n]/, 1)[0];
    const indirect =
      first === "*" ||
      (first === "`" && expression.includes("${")) ||
      (reference &&
        reference !== "process" &&
        /^[A-Za-z_$][\w$]*\s*[.([]/.test(expression)) ||
      (reference &&
        reference !== "process" &&
        !/^(?:string|number|boolean|unknown|any|true|false|null|undefined)$/.test(
          reference,
        ) &&
        new RegExp(`\\b${reference.replace(/[$]/g, "\\$")}\\s*[:=]`).test(
          text,
        ));
    if (indirect) {
      const lines = text.split("\n");
      return {
        text: lines.map(() => "[omitted: indirect credential]").join("\n"),
        redactedCount: 0,
        omittedCount: lines.length,
        warnings: ["Indirect credential evidence was omitted."],
      };
    }
    let closed = true;
    let multilineQuoted = false;
    let escapedContinuation = false;
    if (first === '"' || first === "'" || first === "`") {
      let i = start + 1;
      while (i < text.length && text[i] !== first) {
        if (text[i] === "\n") multilineQuoted = true;
        if (text[i] === "\\") {
          if (text[i + 1] === "\n" || text[i + 1] === "\r")
            multilineQuoted = escapedContinuation = true;
          i++;
        }
        i++;
      }
      closed = i < text.length;
    }
    if (escapedContinuation) {
      const lines = text.split("\n");
      return {
        text: lines.map(() => "[omitted: ambiguous credential]").join("\n"),
        redactedCount: 0,
        omittedCount: lines.length,
        warnings: ["Ambiguous credential evidence was omitted."],
      };
    }
    const lineStart = text.lastIndexOf("\n", match.index) + 1;
    const prefix = text.slice(lineStart, match.index);
    const nextLine = text.indexOf("\n", start);
    const nextEnd = nextLine < 0 ? -1 : text.indexOf("\n", nextLine + 1);
    const following =
      nextLine < 0
        ? ""
        : text.slice(nextLine + 1, nextEnd < 0 ? text.length : nextEnd);
    const indentedContinuation =
      /^\s*$/.test(prefix) &&
      !!following.trim() &&
      (following.match(/^\s*/)?.[0].length ?? 0) > prefix.length;
    // ponytail: ambiguous scalar expressions omit the remainder; use a
    // language-aware parser to safely recover subsequent evidence.
    const ambiguousScalar =
      first === "\\" ||
      /^[!&*#]/.test(first ?? "") ||
      ((/^\s*(?:-\s*)?$/.test(prefix) || /[{,]\s*$/.test(prefix)) &&
        match[1].endsWith(":") &&
        !/^["'`[{|>]/.test(first ?? "") &&
        /\S[ \t]+\S/.test(
          text.slice(start, nextLine < 0 ? text.length : nextLine),
        ));
    const needsScreen =
      /(?:\*\*|&&|\|\||\?\?|>>>|<<|>>|[!?+\-*/%&|^])=$/.test(match[1]) ||
      ambiguousScalar ||
      computed ||
      ambiguousName ||
      multilineQuoted ||
      indentedContinuation ||
      /\/[/*]/.test(match[1]) ||
      first === "|" ||
      first === ">" ||
      first === "`" ||
      plural ||
      !closed ||
      match[1].includes("\n") ||
      /\/[/*]/.test(text.slice(keys.lastIndex, start)) ||
      (start !== keys.lastIndex &&
        text.slice(keys.lastIndex, start).includes("\n")) ||
      first === "{" ||
      first === "[" ||
      /\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\})/.test(raw) ||
      (raw.includes("\\") && !raw.startsWith('"'));
    if (!needsScreen) continue;
    if (
      !/\/[/*]/.test(text.slice(keys.lastIndex, start)) &&
      /^process\.env(?:\.[A-Za-z_]\w*|\[(?:"[^"]+"|'[^']+')\])(?=\s*[,;}\n]|$)/.test(
        text.slice(start),
      )
    )
      continue;
    let end = start;
    if (
      ambiguousScalar ||
      (computed && (!raw.endsWith("]") || !/^[[{"'`]/.test(first ?? ""))) ||
      (first === "`" && text.slice(start).includes("${"))
    ) {
      end = text.length;
    } else if (first === "|" || first === ">") {
      const lineStart = text.lastIndexOf("\n", match.index) + 1;
      const indent =
        text.slice(lineStart, match.index).match(/^\s*/)?.[0].length ?? 0;
      end = text.indexOf("\n", start);
      if (end < 0) end = text.length;
      while (end < text.length) {
        const next = text.indexOf("\n", end + 1);
        const line = text.slice(end + 1, next < 0 ? text.length : next);
        if (line.trim() && (line.match(/^\s*/)?.[0].length ?? 0) <= indent)
          break;
        end = next < 0 ? text.length : next;
      }
    } else if (first === "{" || first === "[") {
      const stack = [first === "{" ? "}" : "]"];
      let quote = "";
      end++;
      for (; end < text.length && stack.length; end++) {
        const c = text[end];
        if (quote) {
          if (c === "\\") end++;
          else if (c === quote) quote = "";
          continue;
        }
        if (c === '"' || c === "'" || c === "`") {
          quote = c;
          continue;
        }
        if (text.startsWith("//", end)) {
          const n = text.indexOf("\n", end + 2);
          if (n < 0) {
            end = text.length;
            break;
          }
          end = n;
          continue;
        }
        if (text.startsWith("/*", end)) {
          const n = text.indexOf("*/", end + 2);
          if (n < 0) {
            end = text.length;
            break;
          }
          end = n + 1;
          continue;
        }
        if (c === "{" || c === "[") {
          if (stack.length >= 256) {
            end = text.length;
            break;
          }
          stack.push(c === "{" ? "}" : "]");
        } else if (c === "}" || c === "]") {
          if (stack.pop() !== c) {
            end = text.length;
            break;
          }
        }
      }
      if (stack.length || quote) end = text.length;
    } else if (first === '"' || first === "'" || first === "`") {
      end++;
      while (end < text.length && text[end] !== first) {
        if (text[end] === "\\") end++;
        end++;
      }
      end = end < text.length ? end + 1 : text.length;
    } else {
      while (end < text.length && !/[,;}\n]/.test(text[end])) end++;
      if (end === start) end = text.length;
    }
    if (
      indentedContinuation &&
      first !== "{" &&
      first !== "[" &&
      !multilineQuoted
    ) {
      let newline = text.indexOf("\n", end);
      while (newline >= 0) {
        const next = text.indexOf("\n", newline + 1);
        const line = text.slice(newline + 1, next < 0 ? text.length : next);
        if (
          line.trim() &&
          (line.match(/^\s*/)?.[0].length ?? 0) <= prefix.length
        )
          break;
        end = next < 0 ? text.length : next;
        newline = next;
      }
    }
    const from = /\/[/*]/.test(match[1])
      ? match.index + raw.length
      : keys.lastIndex;
    screened +=
      text.slice(cursor, from) + text.slice(from, end).replace(/[^\n]+/g, MASK);
    redactedCount++;
    cursor = end;
    keys.lastIndex = end;
  }
  text = screened + text.slice(cursor);
  const lines = text.split("\n").map((line) => {
    if (/-----BEGIN (?:[A-Z0-9 ]*PRIVATE KEY)-----/i.test(line)) inKey = true;
    if (inKey) {
      omittedCount++;
      if (/-----END (?:[A-Z0-9 ]*PRIVATE KEY)-----/i.test(line)) inKey = false;
      return OMIT;
    }

    const mask = (value: string) => {
      if (
        value === MASK ||
        /^process\.env(?:\.[A-Za-z_]\w*|\[(?:"[^"]+"|'[^']+')\])$/.test(value)
      )
        return value;
      redactedCount++;
      return MASK;
    };

    // Mask whole database connection URLs; even their path/query can carry credentials.
    line = line.replace(
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis(?:s)?):\/\/[^\s"'`]+/gi,
      mask,
    );
    // Authorization headers are not ordinary key/value assignments.
    line = line.replace(
      /\b(Bearer|Basic)\s+([^\s"'`,;]+)/gi,
      (_match, scheme: string, value: string) => `${scheme} ${mask(value)}`,
    );
    // HTTP URL userinfo: keep the host and path, not the password.
    line = line.replace(
      /(https?:\/\/[^\s/@"'`]+:)([^\s/@"'`]+)(@)/gi,
      (_match, prefix: string, value: string, suffix: string) =>
        `${prefix}${mask(value)}${suffix}`,
    );
    // Decode query parameter names before deciding whether their values are sensitive.
    line = line.replace(
      /([?&])([^=&#\s"'`]+)=([^&#\s"'`]+)/g,
      (match, separator: string, name: string, value: string) => {
        let decoded: string;
        try {
          decoded = decodeURIComponent(name.replace(/\+/g, " "));
        } catch {
          return `${separator}${name}=${mask(value)}`;
        }
        return credentialName(decoded)
          ? `${separator}${name}=${mask(value)}`
          : match;
      },
    );
    // Quoted values may contain whitespace; keep syntax and surrounding evidence.
    line = line.replace(
      /([A-Za-z_][\w-]*|"(?:\\.|[^"\\\r\n])+"|'[^'\r\n]+')(\s*[:=]\s*)(["'`])((?:\\.|[^\\\r\n])*?)\3/g,
      (match, key: string, sep: string, quote: string, value: string) => {
        let name = key.replace(/^["']|["']$/g, "");
        if (key.startsWith('"')) {
          try {
            name = JSON.parse(key);
          } catch {
            // Keep the existing behavior for non-JSON source syntax.
          }
        }
        return credentialName(name)
          ? `${key}${sep}${quote}${mask(value)}${quote}`
          : match;
      },
    );
    // JSON numbers can also be credentials; preserve the original key spelling.
    line = line.replace(
      /("(?:\\.|[^"\\\r\n])+")(\s*:\s*)(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}\]])/g,
      (match, key: string, sep: string, value: string) => {
        try {
          return credentialName(JSON.parse(key))
            ? `${key}${sep}"${mask(value)}"`
            : match;
        } catch {
          return match;
        }
      },
    );
    line = line.replace(
      /\b((?:[A-Za-z_][\w-]*?)?(?:secret(?:[_-]?access[_-]?key)?|password|(?:access|refresh)[_-]?token|token|api[_-]?key|private[_-]?key))(\s*[:=]\s*)(?!string\b|number\b|boolean\b|unknown\b|any\b)(process\.env\[(?:"[^"]+"|'[^']+')\]|[^\s,;&}"'`]+)/gi,
      (_match, name: string, sep: string, value: string) =>
        `${name}${sep}${mask(value)}`,
    );
    line = line.replace(
      /\b(?:AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g,
      mask,
    );
    return line;
  });
  return {
    text: lines.join("\n"),
    redactedCount,
    omittedCount,
    warnings: [
      ...(redactedCount
        ? ["Sensitive values were redacted from evidence."]
        : []),
      ...(omittedCount
        ? ["Private-key content was omitted from evidence."]
        : []),
    ],
  };
}
