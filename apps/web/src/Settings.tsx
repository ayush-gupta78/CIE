import type { Connection } from "./useLocalHealth";

export function Settings({
  version,
  statusText,
  connection,
  check,
}: {
  version: string;
  statusText: string;
  connection: Connection;
  check: () => void;
}) {
  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <p className="kicker">Preferences</p>
      <h1 id="settings-title">Settings.</h1>
      <p className="intro-copy">
        A small, local foundation. Nothing is indexed or sent anywhere.
      </p>
      <dl className="settings-list">
        <div>
          <dt>Application version</dt>
          <dd>{version}</dd>
        </div>
        <div>
          <dt>Privacy</dt>
          <dd>
            Runs on this device. No telemetry or external runtime service.
          </dd>
        </div>
        <div>
          <dt>Motion</dt>
          <dd>Follows your system’s reduced-motion setting.</dd>
        </div>
        <div>
          <dt>Local API</dt>
          <dd>
            {statusText}.{" "}
            <button
              type="button"
              className="inline-button"
              onClick={() => void check()}
              disabled={connection === "checking"}
            >
              Retry connection
            </button>
          </dd>
        </div>
      </dl>
    </section>
  );
}
