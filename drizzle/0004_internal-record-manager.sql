-- Rename the internal record manager in existing tenant data.
UPDATE knowledge_bases
SET body = jsonb_set(body, '{config,recordManager,provider}', '"internal"'::jsonb)
WHERE body #>> '{config,recordManager,provider}' = 'sqlite';
--> statement-breakpoint
UPDATE knowledge_indexes
SET body = jsonb_set(body, '{config,recordManager,provider}', '"internal"'::jsonb)
WHERE body #>> '{config,recordManager,provider}' = 'sqlite';
