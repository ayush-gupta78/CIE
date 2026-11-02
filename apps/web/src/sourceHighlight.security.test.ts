import { expect, it } from "vitest";
import { highlightLine } from "./sourceHighlight";

it("escapes repository-controlled markup before dangerouslySetInnerHTML", () => {
  const html = highlightLine("<img src=x onerror=alert(1)>", "source.html", 1);
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;");
});
