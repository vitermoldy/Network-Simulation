import express from 'express'

/**
 * The API:
 *   GET    /api/health
 *   POST   /api/runs                 { client, run }        store one finished request
 *   GET    /api/runs/:client                                the latest 50 runs, newest first
 *   GET    /api/layouts/:client                             saved network designs, newest first
 *   GET    /api/layouts/:client/:id                         one design with its JSON
