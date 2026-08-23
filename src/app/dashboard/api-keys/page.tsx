import { requireOrganizationContext } from "@/lib/tenant/context";
import { listApiKeys } from "@/lib/services/api-keys";
import { canManageApiKeys } from "@/lib/crypto/api-keys";
import { ApiKeysView } from "@/components/api-keys/api-keys-view";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "API Keys | Image API Dashboard",
  description: "Manage programmatic secret API keys for image transformation services.",
};

export default async function ApiKeysPage() {
  const context = await requireOrganizationContext();
  const keys = await listApiKeys({ organizationId: context.organization.id });
  const canManage = canManageApiKeys(context.membership.role);

  return (
    <div className="space-y-6">
      <ApiKeysView
        initialKeys={keys}
        canManage={canManage}
        userRole={context.membership.role}
      />
    </div>
  );
}
