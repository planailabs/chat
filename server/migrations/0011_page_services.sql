-- An artifact reads the user's services (list_services, list_tools,
-- read-only tools) only after the user allowed it once, for that page.
ALTER TABLE artifacts ADD COLUMN services_allowed boolean NOT NULL DEFAULT false;
