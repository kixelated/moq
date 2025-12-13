import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'MoQ Documentation',
  description: 'Media over QUIC - Real-time latency at massive scale',
  base: '/',

  head: [
    ['link', { rel: 'icon', href: '/logo.svg', type: 'image/svg+xml' }]
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Getting Started', link: '/getting-started/' },
      { text: 'Guide', link: '/guide/architecture' },
      {
        text: 'API',
        items: [
          { text: 'Rust', link: '/rust/' },
          { text: 'TypeScript', link: '/typescript/' }
        ]
      },
      { text: 'Contributing', link: '/contributing/' }
    ],

    sidebar: {
      '/getting-started/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Quick Start', link: '/getting-started/' },
            { text: 'Installation', link: '/getting-started/installation' },
            { text: 'Demo', link: '/getting-started/demo' },
            { text: 'Core Concepts', link: '/getting-started/concepts' }
          ]
        }
      ],

      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Architecture', link: '/guide/architecture' },
            { text: 'Protocol', link: '/guide/protocol' },
            { text: 'Authentication', link: '/guide/authentication' },
            { text: 'Deployment', link: '/guide/deployment' }
          ]
        }
      ],

      '/rust/': [
        {
          text: 'Rust Libraries',
          items: [
            { text: 'Overview', link: '/rust/' },
            { text: 'moq-lite', link: '/rust/moq-lite' },
            { text: 'hang', link: '/rust/hang' },
            { text: 'moq-relay', link: '/rust/moq-relay' },
            { text: 'Examples', link: '/rust/examples' }
          ]
        }
      ],

      '/typescript/': [
        {
          text: 'TypeScript Libraries',
          items: [
            { text: 'Overview', link: '/typescript/' },
            { text: '@moq/lite', link: '/typescript/lite' },
            { text: '@moq/hang', link: '/typescript/hang' },
            { text: 'Web Components', link: '/typescript/web-components' },
            { text: 'Examples', link: '/typescript/examples' }
          ]
        }
      ],

      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Rust API', link: '/api/rust' }
          ]
        }
      ],

      '/contributing/': [
        {
          text: 'Contributing',
          items: [
            { text: 'Overview', link: '/contributing/' },
            { text: 'Development Setup', link: '/contributing/development' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/moq-dev/moq' },
      { icon: 'discord', link: 'https://discord.gg/FCYF3p99mr' }
    ],

    editLink: {
      pattern: 'https://github.com/moq-dev/moq/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },

    search: {
      provider: 'local'
    },

    lastUpdated: {
      text: 'Last updated',
      formatOptions: {
        dateStyle: 'medium'
      }
    },

    footer: {
      message: 'Licensed under MIT or Apache-2.0',
      copyright: 'Copyright © 2024-present MoQ Contributors'
    }
  },

  markdown: {
    theme: {
      light: 'github-light',
      dark: 'github-dark'
    },
    lineNumbers: true
  },

  ignoreDeadLinks: [
    // Localhost links are for local development
    /^https?:\/\/localhost/
  ]
})
