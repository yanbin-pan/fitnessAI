ALTER TABLE `profile` ADD `name` text;--> statement-breakpoint
ALTER TABLE `profile` ADD `name_prompt` text DEFAULT 'show' NOT NULL;