CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text,
	`media_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `photos_message_idx` ON `photos` (`message_id`);--> statement-breakpoint
CREATE INDEX `photos_created_idx` ON `photos` (`created_at`);--> statement-breakpoint
ALTER TABLE `exercise_items` ADD `activity` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `photo_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE INDEX `messages_created_idx` ON `messages` (`created_at`);--> statement-breakpoint
UPDATE `exercise_items` SET `activity` = CASE
  WHEN lower(`name`) LIKE '%tennis%' THEN 'tennis'
  WHEN lower(`name`) LIKE '%kite%' THEN 'kitesurfing'
  WHEN lower(`name`) LIKE '%wake%' THEN 'wakeboarding'
  WHEN `category` = 'strength' THEN 'gym'
  ELSE 'other'
END;
