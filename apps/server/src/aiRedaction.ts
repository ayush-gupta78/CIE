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
  let redactedCount = 0;
  let omittedCount = 0;
  let inKey = false;
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
      /\bBearer\s+([^\s"'`,;]+)/gi,
      (_match, value: string) => `Bearer ${mask(value)}`,
    );
    // HTTP URL userinfo: keep the host and path, not the password.
    line = line.replace(
      /(https?:\/\/[^\s/@"'`]+:)([^\s/@"'`]+)(@)/gi,
      (_match, prefix: string, value: string, suffix: string) =>
        `${prefix}${mask(value)}${suffix}`,
    );
    // Quoted values may contain whitespace; keep syntax and surrounding evidence.
    line = line.replace(
      /([A-Za-z_][\w-]*|"[^"\r\n]+"|'[^'\r\n]+')(\s*[:=]\s*)(["'`])((?:\\.|[^\\\r\n])*?)\3/g,
      (match, key: string, sep: string, quote: string, value: string) =>
        credentialName(key.replace(/^["']|["']$/g, ""))
          ? `${key}${sep}${quote}${mask(value)}${quote}`
          : match,
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
