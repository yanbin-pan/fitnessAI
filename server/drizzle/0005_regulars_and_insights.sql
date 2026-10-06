CREATE TABLE `insights` (
	`week_start` text PRIMARY KEY NOT NULL,
	`generated_at` text NOT NULL,
	`language` text NOT NULL,
	`model` text,
	`stats` text NOT NULL,
	`report` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `regular_overrides` (
	`key` text PRIMARY KEY NOT NULL,
	`name` text,
	`foods` text,
	`exercises` text,
	`dismissed` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `entries` ADD `regular_key` text;