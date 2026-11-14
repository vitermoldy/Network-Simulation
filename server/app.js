import express from 'express'

/**
 * The API:
 *   GET    /api/health
 *   POST   /api/runs                 { client, run }        store one finished request
 *   GET    /api/runs/:client                                the latest 50 runs, newest first
