CREATE TABLE `chat` (
	`id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`reply_id` text,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_created_idx` ON `chat` (`created_at`);--> statement-breakpoint
CREATE TABLE `consent` (
	`id` integer PRIMARY KEY NOT NULL,
	`granted_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`taken_on` text NOT NULL,
	`title` text NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`language` text DEFAULT '' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `documents_taken_on_idx` ON `documents` (`taken_on`);--> statement-breakpoint
CREATE TABLE `facts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`code` text,
	`label` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`level` text,
	`status` text DEFAULT 'active' NOT NULL,
	`started_on` text,
	`ended_on` text,
	`shared` integer DEFAULT true NOT NULL,
	`document_id` text,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `facts_kind_idx` ON `facts` (`kind`);--> statement-breakpoint
CREATE TABLE `observations` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`position` integer NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`printed_name` text DEFAULT '' NOT NULL,
	`value` real,
	`text_value` text DEFAULT '' NOT NULL,
	`unit` text DEFAULT '' NOT NULL,
	`ref_low` real,
	`ref_high` real,
	`details` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `observations_document_idx` ON `observations` (`document_id`);--> statement-breakpoint
CREATE INDEX `observations_code_idx` ON `observations` (`code`);--> statement-breakpoint
CREATE TABLE `suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`fact` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`fact_id` text,
	`document_id` text,
	`message_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`fact_id`) REFERENCES `facts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `suggestions_document_idx` ON `suggestions` (`document_id`);--> statement-breakpoint
CREATE INDEX `suggestions_message_idx` ON `suggestions` (`message_id`);