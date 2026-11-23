import { env } from 'node:process'
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  ssr: true,
  // Public content is readable before JavaScript; the editor keeps its client-only lifecycle.
  routeRules: {
    '/': { prerender: true },
    '/studio': { ssr: false, headers: { 'X-Robots-Tag': 'noindex' } },
    '/p/**': { ssr: false, headers: { 'X-Robots-Tag': 'noindex' } },
    '/characters': { ssr: false, headers: { 'X-Robots-Tag': 'noindex' } },
    '/characters/**': { ssr: false, headers: { 'X-Robots-Tag': 'noindex' } },
    '/library': { ssr: false, headers: { 'X-Robots-Tag': 'noindex' } },
    '/favorites': { ssr: false, headers: { 'X-Robots-Tag': 'noindex' } },
  },
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
              signInUrl: '/studio',
              signUpUrl: '/studio?auth=sign-up',
              afterSignOutUrl: '/',
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
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
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
