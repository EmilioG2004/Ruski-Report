# Ruski Report Backend

NestJS backend for Ruski Report.

## Commands

```bash
npm install
npm run start:dev
npm test
npm run build
```

The development server listens on `PORT` or `3000` by default.

Health check:

```bash
curl http://localhost:3000/api/health
```

## Structure

- `src/controllers`: HTTP controller boundaries.
- `src/services`: Application and business workflow services.
- `src/repositories`: Persistence interfaces and implementations.
- `src/domain`: Framework-free tournament and game domain contracts.
- `src/ingestion`: Scorebook upload, parsing, validation, and normalization workflows.
- `src/games`: Game plugins such as the v1 Ruski module.
- `src/config`: Environment and application configuration.
- `src/logging`: Logging abstractions and adapters.
- `src/routes`: Route registration notes and future module routing boundaries.
