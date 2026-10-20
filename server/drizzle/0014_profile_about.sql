ALTER TABLE `profile` ADD `about` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `profile` ADD `coach_tone` text DEFAULT 'balanced' NOT NULL;--> statement-breakpoint
ALTER TABLE `profile` ADD `onboarding` text DEFAULT 'show' NOT NULL;