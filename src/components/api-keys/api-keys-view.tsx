"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { ApiKeyDto, CreateApiKeyResult, RotateApiKeyResult } from "@/lib/services/api-keys";
import { ApiKeyStatusFilter } from "@/lib/validations/api-keys";
import { CreateApiKeyDialog } from "./create-api-key-dialog";
import { OneTimeRevealDialog } from "./one-time-reveal-dialog";
import { RotateApiKeyDialog } from "./rotate-api-key-dialog";
import { RevokeApiKeyDialog } from "./revoke-api-key-dialog";

interface ApiKeysViewProps {
  initialKeys: ApiKeyDto[];
  canManage: boolean;
  userRole: string;
}

export function ApiKeysView({ initialKeys, canManage, userRole }: ApiKeysViewProps) {
  const [filter, setFilter] = React.useState<ApiKeyStatusFilter>("all");

  // Dialog States
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [rotatingKey, setRotatingKey] = React.useState<ApiKeyDto | null>(null);
  const [revokingKey, setRevokingKey] = React.useState<ApiKeyDto | null>(null);

  // One-time reveal state (cleared immediately upon dialog dismissal)
  const [revealedKey, setRevealedKey] = React.useState<{
    plaintext: string | null;
    name: string;
  }>({
    plaintext: null,
    name: "",
  });

  const [keys, setKeys] = React.useState<ApiKeyDto[]>(initialKeys);
  const [prevInitialKeys, setPrevInitialKeys] = React.useState(initialKeys);

  // Sync state when server revalidates and passes new initialKeys
  if (initialKeys !== prevInitialKeys) {
    setPrevInitialKeys(initialKeys);
    setKeys(initialKeys);
  }

  const handleCreateSuccess = (result: CreateApiKeyResult) => {
    setIsCreateOpen(false);
    setKeys((prev) => [result.key, ...prev]);
    setRevealedKey({
      plaintext: result.plaintextKey,
      name: result.key.name,
    });
  };

  const handleRotateSuccess = (result: RotateApiKeyResult) => {
    setRotatingKey(null);
    setKeys((prev) => [
      result.newKey,
      ...prev.map((k) => (k.id === result.oldKey.id ? result.oldKey : k)),
    ]);
    setRevealedKey({
      plaintext: result.plaintextKey,
      name: result.newKey.name,
    });
  };

  const handleRevokeSuccess = (revokedKey: ApiKeyDto) => {
    setRevokingKey(null);
    setKeys((prev) => prev.map((k) => (k.id === revokedKey.id ? revokedKey : k)));
  };

  const handleDismissReveal = () => {
    // Explicitly wipe plaintext key from React state
    setRevealedKey({ plaintext: null, name: "" });
  };

  const filteredKeys = React.useMemo(() => {
    if (filter === "all") return keys;
    return keys.filter((k) => k.status === filter);
  }, [keys, filter]);

  const statusCounts = React.useMemo(() => {
    return {
      all: keys.length,
      active: keys.filter((k) => k.status === "active").length,
      expired: keys.filter((k) => k.status === "expired").length,
      revoked: keys.filter((k) => k.status === "revoked").length,
    };
  }, [keys]);

  const formatDate = (isoString: string | null | undefined) => {
    if (!isoString) return "Never";
    const date = new Date(isoString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Create Button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            API Keys
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Manage cryptographically secure secret keys for authenticating image processing requests.
          </p>
        </div>
        {canManage ? (
          <Button
            type="button"
            variant="default"
            size="default"
            onClick={() => setIsCreateOpen(true)}
            className="shrink-0"
          >
            + Create New Secret Key
          </Button>
        ) : (
          <div className="text-xs text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800/80 px-3 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-700">
            Read-only ({userRole} role)
          </div>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center space-x-1 border-b border-neutral-200 dark:border-neutral-800 pb-2">
        {(["all", "active", "expired", "revoked"] as const).map((tab) => {
          const isActive = filter === tab;
          const count = statusCounts[tab];
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                isActive
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800/50"
              }`}
            >
              <span className="capitalize">{tab}</span>
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                  isActive
                    ? "bg-neutral-700 text-white dark:bg-neutral-300 dark:text-neutral-900"
                    : "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-400"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Keys Table / List Card */}
      <Card>
        <CardContent className="p-0">
          {filteredKeys.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center space-y-3">
              <div className="h-10 w-10 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-400 text-lg">
                🔑
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {filter === "all" ? "No API keys generated yet" : `No ${filter} API keys`}
                </p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 max-w-sm">
                  {filter === "all"
                    ? "Create your first API key to start integrating programmatically with the Image API."
                    : `There are currently no API keys matching the '${filter}' filter.`}
                </p>
              </div>
              {canManage && filter === "all" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsCreateOpen(true)}
                >
                  Create API Key
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 text-neutral-500 dark:text-neutral-400">
                    <th className="py-3 px-4 font-medium">Name & Scope</th>
                    <th className="py-3 px-4 font-medium">Key Prefix</th>
                    <th className="py-3 px-4 font-medium">Status</th>
                    <th className="py-3 px-4 font-medium">Created</th>
                    <th className="py-3 px-4 font-medium">Expires</th>
                    <th className="py-3 px-4 font-medium">Last Used</th>
                    {canManage && <th className="py-3 px-4 font-medium text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {filteredKeys.map((k) => {
                    const isUsable = k.status === "active";
                    return (
                      <tr
                        key={k.id}
                        className="hover:bg-neutral-50/50 dark:hover:bg-neutral-800/30 transition-colors"
                      >
                        <td className="py-3 px-4">
                          <div className="font-semibold text-neutral-900 dark:text-neutral-100">
                            {k.name}
                          </div>
                          <div className="flex items-center space-x-1.5 mt-0.5">
                            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700">
                              {k.scopes}
                            </span>
                            {k.createdByUserName && (
                              <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
                                by {k.createdByUserName}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          <span className="font-mono text-xs font-medium text-neutral-800 dark:text-neutral-200 bg-neutral-100 dark:bg-neutral-800 px-2 py-1 rounded">
                            {k.displayPrefix}
                          </span>
                        </td>

                        <td className="py-3 px-4">
                          {k.status === "active" && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                              ● Active
                            </span>
                          )}
                          {k.status === "expired" && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
                              ● Expired
                            </span>
                          )}
                          {k.status === "revoked" && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-neutral-200 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
                              ● Revoked
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-neutral-600 dark:text-neutral-400">
                          {formatDate(k.createdAt)}
                        </td>

                        <td className="py-3 px-4 text-neutral-600 dark:text-neutral-400">
                          {k.expiresAt ? formatDate(k.expiresAt) : "Never"}
                        </td>

                        <td className="py-3 px-4 text-neutral-600 dark:text-neutral-400">
                          {k.lastUsedAt ? formatDate(k.lastUsedAt) : "Never"}
                        </td>

                        {canManage && (
                          <td className="py-3 px-4 text-right space-x-2">
                            {isUsable ? (
                              <>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setRotatingKey(k)}
                                  className="h-7 px-2.5 text-xs font-normal"
                                >
                                  Rotate
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setRevokingKey(k)}
                                  className="h-7 px-2.5 text-xs font-normal text-red-600 hover:text-red-700 hover:border-red-300 dark:text-red-400 dark:hover:text-red-300"
                                >
                                  Revoke
                                </Button>
                              </>
                            ) : (
                              <span className="text-[11px] text-neutral-400 italic">
                                No actions
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modals & Dialogs */}
      <CreateApiKeyDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSuccess={handleCreateSuccess}
      />

      <RotateApiKeyDialog
        apiKey={rotatingKey}
        onClose={() => setRotatingKey(null)}
        onSuccess={handleRotateSuccess}
      />

      <RevokeApiKeyDialog
        apiKey={revokingKey}
        onClose={() => setRevokingKey(null)}
        onSuccess={handleRevokeSuccess}
      />

      <OneTimeRevealDialog
        plaintextKey={revealedKey.plaintext}
        keyName={revealedKey.name}
        onClose={handleDismissReveal}
      />
    </div>
  );
}
