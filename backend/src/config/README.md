# Config

Configuration belongs here. Prefer environment-driven values for deploy-time
settings such as database URL, logging level, admin auth secret, and public base
URL.

## Environment Variables

- `PORT`: HTTP port for the NestJS server. Defaults to `3000`.
- `ADMIN_UPLOAD_TOKEN`: Required token for admin scorebook upload routes. Clients
  must send the matching value in the `x-admin-token` header.

## Application Defaults

- `comments.config.ts`: Match comment limits, including `maxBodyLength`.
