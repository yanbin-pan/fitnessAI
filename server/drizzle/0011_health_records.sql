CREATE TABLE `health_conditions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`label` text,
	`added_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `health_consent` (
	`id` integer PRIMARY KEY NOT NULL,
	`granted_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `lab_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`taken_on` text NOT NULL,
	`lab_name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `lab_results` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`position` integer NOT NULL,
	`marker` text NOT NULL,
	`name` text NOT NULL,
	`printed_name` text DEFAULT '' NOT NULL,
	`value` real,
	`text_value` text DEFAULT '' NOT NULL,
	`unit` text NOT NULL,
	`ref_low` real,
	`ref_high` real,
	FOREIGN KEY (`report_id`) REFERENCES `lab_reports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lab_results_report_idx` ON `lab_results` (`report_id`);--> statement-breakpoint
CREATE INDEX `lab_results_marker_idx` ON `lab_results` (`marker`);--> statement-breakpoint
CREATE TABLE `medications` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`dose` text NOT NULL,
	`started_on` text,
	`stopped_on` text,
	`added_at` text NOT NULL,
	`updated_at` text NOT NULL
);
