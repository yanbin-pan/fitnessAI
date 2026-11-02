CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`expires_on` text,
	`source` text NOT NULL,
	`message_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `profile` ADD `memories` text DEFAULT 'on' NOT NULL;