# RosterWise: Smart Roster Management System

[![CI](https://github.com/Gurpreet-pixel-hue/rosterwise/actions/workflows/ci.yml/badge.svg)](https://github.com/Gurpreet-pixel-hue/rosterwise/actions/workflows/ci.yml)

A browser-based roster planner for a multi-brand customer-operations team. It generates monthly rosters across brands, processes and pods. It also validates coverage and weekly-off rules, flags conflicts with suggested fixes, and handles leave or rule changes without rebuilding the whole month.

> 🚧 In active development. The live demo, setup steps and design notes will be added here.

## Planned scope

- Master data for employees, pods and pod leads, brands, processes, and assignments (primary/backup)
- Configurable brand-process operating calendars (365-day, no public holidays, no Sunday/PH, custom) and minimum staffing
- A deterministic scheduling engine with a single shared validator and named scenario tests
- Company, pod, brand, process and employee views with coverage tracking
- "What-if" change simulation, versioned rosters and diffs

## Stack

Next.js · TypeScript · Prisma · PostgreSQL · Tailwind CSS · Vitest · Vercel
