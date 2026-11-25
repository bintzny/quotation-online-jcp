-- Prisma's pg adapter sends and reads timestamps as UTC wall-clock values without a zone, so every
-- session must run in UTC. The app also asks for it on connect (options "-c TimeZone=UTC"); this
-- database default covers connections where startup options are not passed (e.g. through a pooler).
-- Takes effect for new connections.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC');
END
$$;
