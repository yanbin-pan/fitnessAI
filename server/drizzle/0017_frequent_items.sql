CREATE TABLE `frequent_items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`foods` text NOT NULL,
	`exercises` text NOT NULL,
	`slot` text NOT NULL,
	`source_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
