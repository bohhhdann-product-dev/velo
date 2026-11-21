import { env } from 'node:process'
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  ssr: false,
  devtools: { enabled: false },
  modules: [
    '@pinia/nuxt',
    '@vueuse/nuxt',
    ...(env.CLERK_PUBLISHABLE_KEY || env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY
      ? [
          [
            '@clerk/nuxt',
            {
              publishableKey:
                env.CLERK_PUBLISHABLE_KEY || env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
              skipServerMiddleware: true,
            },
          ] as [string, Record<string, unknown>],
        ]
      : []),
  ],
  runtimeConfig: {
    clerk: { secretKey: env.CLERK_SECRET_KEY || '' },
    public: {
      appMode: env.NUXT_PUBLIC_APP_MODE || 'demo',
      clerkPublishableKey:
        env.CLERK_PUBLISHABLE_KEY || env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '',
    },
  },
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
  },
  app: {
    head: {
      title: 'Vela',
      meta: [
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1, viewport-fit=cover',
        },
        {
          name: 'description',
          content: 'Create images and video with AI. Simply.',
        },
      ],
      htmlAttrs: { lang: 'en' },
    },
  },
})
