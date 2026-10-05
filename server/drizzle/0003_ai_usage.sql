CREATE TABLE `ai_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`message_id` text NOT NULL,
	`model` text,
	`calls` integer NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cache_read_tokens` integer NOT NULL,
	`cache_write_tokens` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_usage_date_idx` ON `ai_usage` (`date`);