import type { DriverSessionSummary } from "../types";

export function DriverPicker({
  side,
  drivers,
  selectedId,
  onSelect,
  race,
}: {
  side: "left" | "right";
  drivers: DriverSessionSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  race: boolean;
}) {
  const selected = drivers.find((driver) => driver.id === selectedId);
  return (
    <div className={"driver-roster driver-roster--" + side}>
      <div className="roster-heading">
        <span className="eyebrow">
          {side === "left" ? "Driver 1 · Left" : "Driver 2 · Right"}
        </span>
        <strong>
          {selected ? selected.acronym + " selected" : "Choose a driver"}
        </strong>
      </div>
      <div
        className="roster-list"
        role="group"
        aria-label={
          side === "left" ? "Choose left driver" : "Choose right driver"
        }
        tabIndex={0}
      >
        {drivers.map((driver) => (
          <button
            type="button"
            key={driver.id}
            className={
              "roster-card" + (selectedId === driver.id ? " is-selected" : "")
            }
            aria-pressed={selectedId === driver.id}
            aria-label={"Select " + driver.fullName + " as " + side + " driver"}
            onClick={() => onSelect(driver.id)}
          >
            <span className="roster-position">
              {driver.result.position !== null
                ? "P" + driver.result.position
                : "—"}
            </span>
            <span className="roster-person">
              <strong>{driver.fullName}</strong>
              <span>
                {driver.teamName} · #{driver.driverNumber}
              </span>
            </span>
            <span className="roster-status">
              {selectedId === driver.id
                ? "✓"
                : driver.result.status !== "classified" &&
                    driver.result.status !== "unavailable"
                  ? driver.result.classificationLabel
                  : driver.acronym}
            </span>
          </button>
        ))}
      </div>
      <p className="roster-footnote">
        {race ? "Official finishing order" : "Session classification"} · scroll
        for all {drivers.length} drivers
      </p>
    </div>
  );
}
