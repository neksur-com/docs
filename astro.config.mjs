// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// Neksur public documentation — docs.neksur.com
// Static Starlight site, deployed to Cloudflare Pages (build → ./dist).
export default defineConfig({
  site: "https://docs.neksur.com",
  integrations: [
    starlight({
      title: "Neksur Docs",
      description:
        "The Data Contract Plane for open lakehouses on Apache Iceberg.",
      tagline: "The Data Contract Plane for open lakehouses",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/neksur-com/neksur",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/neksur-com/docs/edit/main/",
      },
      lastUpdated: true,
      sidebar: [
        {
          label: "Introduction",
          items: [{ slug: "intro/what-is-neksur" }],
        },
        {
          label: "Getting started",
          items: [{ slug: "getting-started/install-and-first-policy" }],
        },
        {
          label: "Concepts",
          items: [
            { slug: "concepts" },
            { slug: "concepts/data-contract" },
            { slug: "concepts/dimensions" },
            { slug: "concepts/lifecycle" },
            { slug: "concepts/enforcement" },
            { slug: "concepts/editions" },
          ],
        },
        {
          label: "Guides",
          items: [
            { slug: "guides" },
            { slug: "guides/connect-spark-write-path" },
            { slug: "guides/connect-read-path" },
            { slug: "guides/ai-agents-mcp" },
            { slug: "guides/author-access-policies" },
            { slug: "guides/author-semantic-metrics" },
            { slug: "guides/author-and-ship-a-contract" },
            { slug: "guides/data-quality" },
            { slug: "guides/compliance-and-audit" },
            { slug: "guides/using-the-web-console" },
          ],
        },
        {
          label: "Reference",
          items: [
            { slug: "reference/rest-api" },
            { slug: "reference/cli" },
            { slug: "reference/policy-language" },
          ],
        },
        {
          label: "Architecture",
          items: [{ slug: "architecture/overview" }],
        },
        {
          label: "Operations",
          items: [{ slug: "operations/deploy" }],
        },
        {
          label: "Licensing",
          items: [{ slug: "licensing" }],
        },
        {
          label: "Examples",
          items: [{ slug: "examples" }],
        },
      ],
    }),
  ],
});
