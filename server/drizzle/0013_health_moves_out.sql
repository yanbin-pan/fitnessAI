-- The Health tab moved to health.db (2026-10-19 health tab design §1): moveLegacyHealth copies these rows there,
-- keeping their ids, just before this runs.
DROP TABLE `health_conditions`;--> statement-breakpoint
DROP TABLE `health_consent`;--> statement-breakpoint
DROP TABLE `lab_reports`;--> statement-breakpoint
DROP TABLE `lab_results`;--> statement-breakpoint
DROP TABLE `medications`;