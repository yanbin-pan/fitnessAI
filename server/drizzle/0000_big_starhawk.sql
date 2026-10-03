CREATE TABLE `coach_threads` (
	`date` text PRIMARY KEY NOT NULL,
	`system` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `coach_turns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`seq` integer NOT NULL,
	`role` text NOT NULL,
	`blocks` text NOT NULL,
	`message_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coach_turns_date_seq_idx` ON `coach_turns` (`date`,`seq`);--> statement-breakpoint
CREATE TABLE `days` (
	`date` text PRIMARY KEY NOT NULL,
	`base_kcal` real NOT NULL,
	`base_protein_g` real NOT NULL,
	`base_carbs_g` real NOT NULL,
	`base_fat_g` real NOT NULL,
	`base_fibre_g` real NOT NULL,
	`add_back_pct` real NOT NULL,
	`weight_kg_used` real NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`logged_at` text NOT NULL,
	`source` text NOT NULL,
	`message_id` text,
	`external_id` text,
	`merged_into_entry_id` text,
	`edited` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entries_external_id_unique` ON `entries` (`external_id`);--> statement-breakpoint
CREATE INDEX `entries_date_idx` ON `entries` (`date`);--> statement-breakpoint
CREATE TABLE `exercise_items` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`duration_min` real,
	`sets` real,
	`reps` real,
	`weight_kg` real,
	`distance_km` real,
	`avg_hr` real,
	`met` real,
	`kcal` real NOT NULL,
	`kcal_measured` integer DEFAULT false NOT NULL,
	`assumption` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exercise_items_entry_idx` ON `exercise_items` (`entry_id`);--> statement-breakpoint
CREATE TABLE `exercise_muscles` (
	`exercise_item_id` text NOT NULL,
	`muscle` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`exercise_item_id`, `muscle`),
	FOREIGN KEY (`exercise_item_id`) REFERENCES `exercise_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `food_item_groups` (
	`food_item_id` text NOT NULL,
	`food_group` text NOT NULL,
	`portions` real NOT NULL,
	PRIMARY KEY(`food_item_id`, `food_group`),
	FOREIGN KEY (`food_item_id`) REFERENCES `food_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `food_items` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`quantity` text NOT NULL,
	`grams` real,
	`kcal` real NOT NULL,
	`protein_g` real NOT NULL,
	`carbs_g` real NOT NULL,
	`fat_g` real NOT NULL,
	`fibre_g` real NOT NULL,
	`saturated_fat_g` real NOT NULL,
	`sugars_g` real NOT NULL,
	`salt_g` real NOT NULL,
	`fluid_ml` real NOT NULL,
	`alcohol_units` real NOT NULL,
	`assumption` text NOT NULL,
	`saved_food_id` text,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `food_items_entry_idx` ON `food_items` (`entry_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`cards` text NOT NULL,
	`status` text,
	`error_code` text,
	`reply_to` text,
	`sent_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_reply_to_unique` ON `messages` (`reply_to`);--> statement-breakpoint
CREATE INDEX `messages_date_idx` ON `messages` (`date`);--> statement-breakpoint
CREATE TABLE `profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`sex` text NOT NULL,
	`birth_date` text NOT NULL,
	`height_cm` real NOT NULL,
	`weight_kg` real NOT NULL,
	`activity_level` text NOT NULL,
	`goal` text NOT NULL,
	`goal_rate_kg_week` real NOT NULL,
	`body_goal_priority` text NOT NULL,
	`protein_g_per_kg` real NOT NULL,
	`fat_pct` real NOT NULL,
	`fibre_g` real NOT NULL,
	`add_back_pct` real NOT NULL,
	`override_kcal` real,
	`override_protein_g` real,
	`override_carbs_g` real,
	`override_fat_g` real,
	`override_fibre_g` real,
	`timezone` text NOT NULL,
	`units_mass` text NOT NULL,
	`units_length` text NOT NULL,
	`context_days` integer NOT NULL,
	`goal_notes` text NOT NULL,
	`updated_at` text NOT NULL
);
