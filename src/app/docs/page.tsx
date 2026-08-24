import { Metadata } from "next";
import { SwaggerPortal } from "@/components/docs/swagger-portal";

export const metadata: Metadata = {
  title: "API Documentation | Image API Developer Portal",
  description: "Interactive OpenAPI 3.1.1 specification and testing portal for Image API.",
};

export default function DocsPage() {
  return <SwaggerPortal />;
}
