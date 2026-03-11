import { defineConfig } from 'vitepress';
import typedocSidebar from '../api/typedoc-sidebar.json';

export default defineConfig({
  title: 'givenergy-modbus',
  description: 'Native Node.js client for GivEnergy inverters over Modbus TCP',
  base: '/givenergy-modbus/',

  themeConfig: {
    nav: [
      { text: 'Getting Started', link: '/getting-started' },
      { text: 'Concepts', link: '/concepts' },
      { text: 'Cookbook', link: '/cookbook' },
      { text: 'Protocol', link: '/protocol' },
      { text: 'API Reference', link: '/api/' },
    ],

    sidebar: {
      '/api/': [
        {
          text: 'API Reference',
          items: [{ text: 'Back to Guide', link: '/getting-started' }],
        },
        ...typedocSidebar,
      ],
      '/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/getting-started' },
            { text: 'Concepts', link: '/concepts' },
            { text: 'Cookbook', link: '/cookbook' },
            { text: 'Protocol Internals', link: '/protocol' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/jak/givenergy-modbus' },
    ],

    editLink: {
      pattern: 'https://github.com/jak/givenergy-modbus/edit/main/website/:path',
    },

    search: {
      provider: 'local',
    },
  },
});
