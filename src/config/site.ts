/**
 * Centralized site and product configuration.
 *
 * Use neutral temporary product label 'Image API' as specified in Milestone 0.
 * Centralizing here allows renaming later across all UI surfaces easily.
 */
export const siteConfig = {
  name: "Image API",
  description: "High-performance usage-based image processing API for developers.",
  links: {
    docs: "/docs",
  },
} as const;
