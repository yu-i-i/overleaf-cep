#!/usr/bin/env node

import app from './server.mjs'

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...')
  app.close(() => {
    console.log('DropboxInterface stopped')
    process.exit(0)
  })
})

export default app
