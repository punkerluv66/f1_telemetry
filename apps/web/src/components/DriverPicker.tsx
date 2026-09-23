import { useState } from "react";
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
  const [query, setQuery] = useState("");
  const matches = drivers.filter((driver) =>
    `${driver.fullName} ${driver.teamName} ${driver.driverNumber} ${driver.acronym}`
      .toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <div className={"driver-roster driver-roster--" + side}>
      <div className="roster-heading">
        <span className="eyebrow">
          {side === "left" ? "Reference driver" : "Comparison driver"}
        </span>
        <strong>
          {selected ? selected.fullName : "Select a driver"}
        </strong>
      </div>
      <div className="roster-search">
        <input type="search" aria-label={`Search ${side} drivers`}
          placeholder="Search name, team or number" value={query}
          onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div
        className="roster-list"
        role="group"
        aria-label={
          side === "left" ? "Choose left driver" : "Choose right driver"
        }
        tabIndex={0}
      >
        {matches.map((driver) => (
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
        {!matches.length && <p className="roster-empty">No matching drivers.</p>}
      </div>
      <p className="roster-footnote">
        {race ? "Race classification" : "Session classification"} · {matches.length} of {drivers.length} drivers
      </p>
    </div>
  );
}
