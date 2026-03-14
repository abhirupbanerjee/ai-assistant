-- Create a separate database for LiteLLM proxy.
-- Runs during Postgres first-time init (docker-entrypoint-initdb.d).
-- Keeps LiteLLM's 50+ Prisma-managed tables out of the app's database.
CREATE DATABASE litellm;
