import { useEffect, useRef, useState } from "react";
import {
  askAi,
  getAiConfig,
  verifiedCitation,
  type AiAnswer,
  type AiCitation,
  type AiConfig,
} from "./aiApi";
import { getGraph, type FileNode, type Graph } from "./graphApi";
import { getSource } from "./sourceApi";
import type { Connection } from "./useLocalHealth";

type Turn = { question: string; result: AiAnswer };
export function Assistant({
  graph,
  selected,
  connection,
  onOpenSettings,
  onCitation,
}: {
  graph: Graph | null;
  selected: FileNode | null;
  connection: Connection;
  onOpenSettings: () => void;
  onCitation: (citation: AiCitation) => void;
}) {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [current, setCurrent] = useState(true);
  const pending = useRef<AbortController | null>(null);
  const verification = useRef<AbortController | null>(null);
  const graphKey = graph
    ? `${graph.repositoryId}:${graph.revision}:${graph.manifest}`
    : "none";
  useEffect(() => {
    const controller = new AbortController();
    pending.current?.abort();
    verification.current?.abort();
    setTurns([]);
    setError("");
    setBusy(false);
    setCurrent(true);
    return () => {
      controller.abort();
      pending.current?.abort();
      verification.current?.abort();
    };
  }, [graphKey]);
  useEffect(() => {
    if (connection !== "connected") {
      setConfig(null);
      pending.current?.abort();
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    void getAiConfig(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setConfig(value);
      })
      .catch((issue: unknown) => {
        if (!controller.signal.aborted)
          setError(
            issue instanceof Error
              ? issue.message
              : "Assistant settings unavailable.",
          );
      });
    return () => controller.abort();
  }, [connection]);
  useEffect(() => {
    if (!graph || connection !== "connected") return;
    const controller = new AbortController();
    const verify = () => {
      if (document.visibilityState !== "visible") return;
      verification.current?.abort();
      const next = new AbortController();
      verification.current = next;
      pending.current?.abort();
      setBusy(false);
      setCurrent(false);
      setChecking(true);
      void getGraph(
        {
          selected: true,
          repositoryId: graph.repositoryId,
          revision: graph.revision,
          rootName: "local",
        },
        next.signal,
      )
        .then((latest) => {
          if (!next.signal.aborted)
            setCurrent(latest.manifest === graph.manifest);
        })
        .catch(() => {
          if (!next.signal.aborted) setCurrent(false);
        })
        .finally(() => {
          if (!next.signal.aborted) setChecking(false);
        });
    };
    window.addEventListener("focus", verify);
    return () => {
      controller.abort();
      verification.current?.abort();
      window.removeEventListener("focus", verify);
    };
  }, [graphKey, connection]);
  async function ask() {
    if (
      !graph ||
      !question.trim() ||
      busy ||
      !config?.enabled ||
      !config.consent ||
      !config.hasKey ||
      !current ||
      connection !== "connected"
    )
      return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      const latest = await getGraph(
        {
          selected: true,
          repositoryId: graph.repositoryId,
          revision: graph.revision,
          rootName: "local",
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (latest.manifest !== graph.manifest) {
        setCurrent(false);
        setTurns([]);
        setError("Graph changed. Reload the atlas before asking again.");
        return;
      }
      const result = await askAi(
        graph,
        question.trim(),
        selected?.id,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setTurns((previous) => [
          ...previous,
          { question: question.trim(), result },
        ]);
        setQuestion("");
      }
    } catch (issue) {
      if (!controller.signal.aborted)
        setError(
          issue instanceof Error ? issue.message : "Assistant unavailable.",
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }
  async function navigate(citation: AiCitation) {
    if (!graph || !current || checking || !verifiedCitation(graph, citation))
      return;
    const controller = new AbortController();
    pending.current = controller;
    setChecking(true);
    try {
      const latest = await getGraph(
        {
          selected: true,
          repositoryId: graph.repositoryId,
          revision: graph.revision,
          rootName: "local",
        },
        controller.signal,
      );
      if (latest.manifest !== graph.manifest) {
        setCurrent(false);
        setTurns([]);
        setError("Graph changed. Re-analyze or reload before using citations.");
        return;
      }
      const file = graph.files.find((item) => item.id === citation.fileId)!;
      if (citation.startLine !== undefined || citation.edgeId) {
        const source = await getSource(graph, file, controller.signal);
        const sourceLine = citation.startLine
          ? source.text.split("\n")[citation.startLine - 1]
          : undefined;
        if (
          source.freshness !== "verified" ||
          (citation.quote &&
            (!sourceLine || !sourceLine.includes(citation.quote))) ||
          (citation.startLine !== undefined &&
            citation.startLine > source.lineCount) ||
          (citation.endLine !== undefined &&
            citation.endLine > source.lineCount)
        ) {
          setError(
            "Source is not verified at this snapshot; re-analyze before navigating to a line.",
          );
          return;
        }
      }
      if (!controller.signal.aborted) onCitation(citation);
    } catch (issue) {
      if (!controller.signal.aborted)
        setError(
          issue instanceof Error ? issue.message : "Citation unavailable.",
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setChecking(false);
      }
    }
  }
  return (
    <section className="ai-assistant" aria-label="Contextual assistant">
      <div className="ai-assistant-head">
        <div>
          <p className="kicker">Optional · external provider</p>
          <h2>Ask about this graph</h2>
        </div>
        <button type="button" onClick={onOpenSettings}>
          Provider settings & consent
        </button>
      </div>
      <p>
        Explicit questions send bounded source context to OpenAI. Check cited
        source before relying on an answer.
      </p>
      <p
        className="ai-context"
        title={graph ? `${graph.repositoryId} · ${graph.manifest}` : undefined}
      >
        Context:{" "}
        {graph
          ? `repository ${graph.repositoryId.slice(0, 8)} · revision ${graph.revision} · snapshot ${graph.manifest.slice(0, 12)}`
          : "No analyzed repository"}
        {selected ? ` · ${selected.path}` : " · repository-wide"}
      </p>
      <p role="status">
        {connection !== "connected"
          ? "Assistant unavailable: local API disconnected."
          : !config
            ? "Checking assistant configuration…"
            : !config.enabled
              ? "Assistant disabled in Settings."
              : !config.hasKey || !config.consent
                ? "Assistant unconfigured: save an API key and explicit consent in Settings."
                : busy
                  ? "Processing assistant question…"
                  : !graph
                    ? "Assistant ready; analyze a repository to ask."
                    : "Assistant ready · OpenAI · gpt-4o-mini · External transmission enabled"}
      </p>
      {!current && (
        <p role="alert">
          Graph snapshot changed or cannot be verified. Reload the atlas before
          using this conversation.
        </p>
      )}
      <div className="ai-turns" aria-live="polite">
        {current &&
          turns.map((turn, index) => (
            <article key={index}>
              <h3>Question</h3>
              <p>{turn.question}</p>
              <h3>
                Answer ·{" "}
                {turn.result.status === "cited"
                  ? "source quotes cited; interpretation unverified"
                  : "insufficient evidence"}
              </h3>
              <p>{turn.result.answer || "No grounded answer available."}</p>
              {turn.result.citations.length > 0 && (
                <ul aria-label="Answer citations">
                  {turn.result.citations.map((citation, position) => (
                    <li key={`${index}-${position}`}>
                      {verifiedCitation(graph!, citation) ? (
                        <button
                          type="button"
                          disabled={
                            checking || busy || connection !== "connected"
                          }
                          onClick={() => void navigate(citation)}
                        >
                          {citation.path}
                          {citation.startLine
                            ? `:${citation.startLine}${citation.endLine && citation.endLine !== citation.startLine ? `–${citation.endLine}` : ""}`
                            : ""}{" "}
                          · {citation.category}
                        </button>
                      ) : (
                        <span>
                          {citation.path} · Unverified citation; navigation
                          unavailable
                        </span>
                      )}
                      {citation.quote && (
                        <blockquote>“{citation.quote}”</blockquote>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {turn.result.limitations.length > 0 && (
                <p>Limitations: {turn.result.limitations.join(" · ")}</p>
              )}
              {turn.result.warnings.length > 0 && (
                <p>Warnings: {turn.result.warnings.join(" · ")}</p>
              )}
            </article>
          ))}
      </div>
      {graph && config?.enabled && config.hasKey && config.consent && (
        <div className="ai-suggestions" aria-label="Suggested questions">
          <p>Ask about this context:</p>
          {(selected
            ? [
                `What does ${selected.path} depend on?`,
                `What depends on ${selected.path}?`,
              ]
            : [
                "Which files are connected in this repository?",
                "Where is analysis incomplete?",
              ]
          ).map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => setQuestion(suggestion)}
              disabled={
                busy || checking || !current || connection !== "connected"
              }
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <label htmlFor="ai-question">
          Question{" "}
          {selected ? `about ${selected.path}` : "about the repository"}
        </label>
        <textarea
          id="ai-question"
          value={question}
          maxLength={2000}
          rows={3}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="What does this file depend on?"
        />
        <div>
          <button
            type="submit"
            disabled={
              !graph ||
              !question.trim() ||
              busy ||
              checking ||
              !current ||
              connection !== "connected" ||
              !config?.enabled ||
              !config.consent ||
              !config.hasKey
            }
          >
            Ask assistant
          </button>
          {busy && (
            <button
              type="button"
              onClick={() => {
                pending.current?.abort();
                pending.current = null;
                setBusy(false);
              }}
            >
              Cancel request
            </button>
          )}
        </div>
      </form>
      {checking && <p role="status">Verifying graph and source…</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
