import { defineConfig } from "vitepress";

export default defineConfig({
  title: "if-else",
  description: "If-this-then-that automations — project wiki",
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: [
    /^https?:\/\/localhost/,
  ],
  themeConfig: {
    logo: undefined,
    siteTitle: "if-else wiki",
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Integrations", link: "/integrations/" },
      { text: "Reference", link: "/reference/env" },
      {
        text: "GitHub",
        link: "https://github.com/mayakarabula/if-else",
      },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            { text: "Getting started", link: "/guide/getting-started" },
            { text: "Architecture", link: "/guide/architecture" },
            { text: "Rules & graph editor", link: "/guide/rules" },
            { text: "Agent chat", link: "/guide/agent-chat" },
            { text: "CLI & MCP", link: "/guide/cli-mcp" },
            { text: "Queue & runs", link: "/guide/queue" },
          ],
        },
      ],
      "/integrations/": [
        {
          text: "Integrations",
          items: [
            { text: "Overview", link: "/integrations/" },
            { text: "Custom HTTP", link: "/integrations/custom" },
            { text: "Time", link: "/integrations/time" },
            { text: "Weather", link: "/integrations/weather" },
            { text: "Telegram", link: "/integrations/telegram" },
            { text: "Gmail", link: "/integrations/gmail" },
            { text: "Home Assistant", link: "/integrations/home-assistant" },
            { text: "Zigbee", link: "/integrations/zigbee" },
            { text: "Google Docs / Sheets", link: "/integrations/google" },
            { text: "Notion", link: "/integrations/notion" },
            { text: "Cursor Agent", link: "/integrations/cursor" },
            { text: "Shell script", link: "/integrations/script" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "Reference",
          items: [
            { text: "Environment variables", link: "/reference/env" },
            { text: "Data layout", link: "/reference/data" },
            { text: "Local development", link: "/reference/local-dev" },
          ],
        },
      ],
    },
    search: {
      provider: "local",
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/mayakarabula/if-else" },
    ],
    footer: {
      message: "Project wiki for if-else automations",
      copyright: "Built with VitePress",
    },
    editLink: {
      pattern: "https://github.com/mayakarabula/if-else/edit/main/wiki/:path",
      text: "Edit this page on GitHub",
    },
  },
  head: [["link", { rel: "icon", href: "/favicon.svg" }]],
});
