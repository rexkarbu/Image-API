import { UsageTimeBucketDto } from "@/types/usage";

interface UsageChartProps {
  timeSeries: UsageTimeBucketDto[];
  totalUnits: number;
}

export function UsageChart({ timeSeries, totalUnits }: UsageChartProps) {
  const maxUnits = Math.max(...timeSeries.map((b) => b.units), 1);

  if (totalUnits === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Usage Over Time
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              UTC aggregation for selected period
            </p>
          </div>
          <span className="text-xs font-mono text-neutral-500">0 units total</span>
        </div>

        <div className="h-44 rounded-md border border-dashed border-neutral-200 dark:border-neutral-800 flex flex-col items-center justify-center p-6 text-center space-y-1">
          <p className="text-xs font-mono text-neutral-500 dark:text-neutral-400">
            No transformation events in this range
          </p>
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
            Incoming requests to <code className="bg-neutral-100 dark:bg-neutral-800 px-1 py-0.5 rounded">POST /v1/images/transform</code> will appear here in near-real-time.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Usage Over Time
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            UTC aggregation for selected period
          </p>
        </div>
        <div className="text-right">
          <span className="text-xs font-mono font-semibold text-neutral-900 dark:text-neutral-100">
            {totalUnits.toLocaleString()} units
          </span>
          <div className="text-[10px] text-neutral-400">Peak: {maxUnits.toLocaleString()} units/bucket</div>
        </div>
      </div>

      {/* SVG / CSS Bar Chart Visualization with horizontal scrolling for large bucket sets (e.g. 90d) */}
      <div className="relative pt-4 pb-1 overflow-x-auto" aria-hidden="true">
        <div
          className="flex items-end space-x-1 sm:space-x-1.5 h-36 w-full"
          style={{ minWidth: timeSeries.length > 30 ? `${timeSeries.length * 10}px` : "100%" }}
        >
          {timeSeries.map((bucket) => {
            const heightPercent = Math.max((bucket.units / maxUnits) * 100, bucket.units > 0 ? 4 : 1);
            return (
              <div
                key={bucket.timestamp}
                className="flex-1 flex flex-col items-center justify-end h-full group relative min-w-[3px]"
              >
                {/* Hover / Focus Tooltip */}
                <div className="absolute bottom-full mb-1 hidden group-hover:flex group-focus:flex flex-col items-center pointer-events-none z-10">
                  <div className="bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[10px] rounded px-2 py-1 shadow whitespace-nowrap">
                    <div className="font-semibold font-mono">
                      {bucket.units.toLocaleString()} {bucket.units === 1 ? "unit" : "units"}
                    </div>
                    <div className="text-[9px] text-neutral-400 dark:text-neutral-600">
                      {bucket.label} (UTC)
                    </div>
                  </div>
                </div>

                {/* Bar Element */}
                <div
                  style={{ height: `${heightPercent}%` }}
                  className={`w-full rounded-t motion-safe:transition-all ${
                    bucket.units > 0
                      ? "bg-neutral-900 dark:bg-neutral-100 group-hover:bg-neutral-700 dark:group-hover:bg-neutral-300"
                      : "bg-neutral-100 dark:bg-neutral-800"
                  }`}
                />
              </div>
            );
          })}
        </div>

        {/* X-Axis Labels */}
        <div className="flex justify-between items-center text-[10px] font-mono text-neutral-400 dark:text-neutral-500 pt-2 border-t border-neutral-100 dark:border-neutral-800">
          <span>{timeSeries[0]?.label || "Start"} (UTC)</span>
          {timeSeries.length > 2 && (
            <span>{timeSeries[Math.floor(timeSeries.length / 2)]?.label || ""}</span>
          )}
          <span>{timeSeries[timeSeries.length - 1]?.label || "End"} (UTC)</span>
        </div>
      </div>

      {/* Accessible Nonvisual Data Summary for Screen Readers */}
      <div className="sr-only">
        <h3>Usage over time data table</h3>
        <p>Total units: {totalUnits}. Max units in a single bucket: {maxUnits}.</p>
        <table>
          <thead>
            <tr>
              <th scope="col">Time Bucket (UTC)</th>
              <th scope="col">Units</th>
            </tr>
          </thead>
          <tbody>
            {timeSeries.map((b) => (
              <tr key={b.timestamp}>
                <td>{b.label} ({b.timestamp})</td>
                <td>{b.units}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
