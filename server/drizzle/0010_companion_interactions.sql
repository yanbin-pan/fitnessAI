CREATE TABLE `companion_interactions` (
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`date`, `kind`)
);
