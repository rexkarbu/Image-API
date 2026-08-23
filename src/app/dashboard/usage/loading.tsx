export default function UsageLoading() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading usage data">
      {/* Header Skeleton */}
      <div className="space-y-2">
        <div className="h-4 w-32 bg-neutral-200 dark:bg-neutral-800 rounded" />
        <div className="h-7 w-48 bg-neutral-200 dark:bg-neutral-800 rounded" />
        <div className="h-4 w-72 bg-neutral-100 dark:bg-neutral-800/60 rounded" />
      </div>

      {/* Summary Cards Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-28 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-3"
          >
            <div className="h-3 w-20 bg-neutral-200 dark:bg-neutral-800 rounded" />
            <div className="h-6 w-24 bg-neutral-300 dark:bg-neutral-700 rounded" />
            <div className="h-2.5 w-32 bg-neutral-100 dark:bg-neutral-800/60 rounded" />
          </div>
        ))}
      </div>

      {/* Filters Bar Skeleton */}
      <div className="h-24 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3">
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-7 w-14 bg-neutral-200 dark:bg-neutral-800 rounded" />
          ))}
        </div>
      </div>

      {/* Chart Skeleton */}
      <div className="h-64 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 space-y-4">
        <div className="h-4 w-36 bg-neutral-200 dark:bg-neutral-800 rounded" />
        <div className="h-40 bg-neutral-100 dark:bg-neutral-800/40 rounded" />
      </div>

      {/* Breakdown & Events Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="h-72 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6" />
        <div className="lg:col-span-2 h-72 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6" />
      </div>
    </div>
  );
}
