-- Milestone 2.1 (spec §5.1): exercises still filed as `other` move to the activity their name clearly
-- names. A pattern must start a word, so the name is lowercased, its hyphens and slashes become spaces,
-- and it gets a leading space ("Kick-boxing" reads " kick boxing"). The first match wins; the running,
-- walking, cycling, swimming and hiking patterns only re-file cardio or sport exercises; the rest stay `other`.
WITH `named` AS (
  SELECT `id`, `category`, ' ' || replace(replace(lower(`name`), '-', ' '), '/', ' ') AS `h`
  FROM `exercise_items`
  WHERE `activity` = 'other'
), `refiled` AS (
  SELECT `id`, CASE
    WHEN `h` LIKE '% photo%' THEN 'photography'
    WHEN `h` LIKE '% padel%' THEN 'padel'
    WHEN `h` LIKE '% badminton%' THEN 'badminton'
    WHEN `h` LIKE '% boxing%' OR `h` LIKE '% kickboxing%' THEN 'boxing'
    WHEN `h` LIKE '% karate%' OR `h` LIKE '% judo%' OR `h` LIKE '% jiu%' OR `h` LIKE '% taekwondo%' OR `h` LIKE '% martial%' THEN 'martial_arts'
    WHEN `h` LIKE '% yoga%' OR `h` LIKE '% pilates%' THEN 'yoga'
    WHEN `h` LIKE '% boulder%' OR `h` LIKE '% rock climb%' OR `h` LIKE '% climbing wall%' THEN 'climbing'
    WHEN `category` IN ('cardio', 'sport') AND (`h` LIKE '% hike%' OR `h` LIKE '% hiking%') THEN 'hiking'
    WHEN `category` IN ('cardio', 'sport') AND (`h` LIKE '% run%' OR `h` LIKE '% jog%') THEN 'running'
    WHEN `category` IN ('cardio', 'sport') AND `h` LIKE '% walk%' THEN 'walking'
    WHEN `category` IN ('cardio', 'sport') AND (`h` LIKE '% cycl%' OR `h` LIKE '% bicycle%' OR `h` LIKE '% bike%' OR `h` LIKE '% biking%' OR `h` LIKE '% spinning%') THEN 'cycling'
    WHEN `category` IN ('cardio', 'sport') AND `h` LIKE '% swim%' THEN 'swimming'
    WHEN `h` LIKE '% rowing%' OR `h` LIKE '% rower%' THEN 'rowing'
    WHEN `h` LIKE '% kayak%' OR `h` LIKE '% canoe%' OR `h` LIKE '% paddleboard%' THEN 'kayaking'
    WHEN `h` LIKE '% sail%' THEN 'sailing'
    WHEN `h` LIKE '% diving%' OR `h` LIKE '% scuba%' OR `h` LIKE '% snorkel%' THEN 'diving'
    WHEN `h` LIKE '% surf%' THEN 'surfing'
    WHEN `h` LIKE '% football%' OR `h` LIKE '% soccer%' THEN 'football'
    WHEN `h` LIKE '% basketball%' THEN 'basketball'
    WHEN `h` LIKE '% volleyball%' THEN 'volleyball'
    WHEN `h` LIKE '% rugby%' THEN 'rugby'
    WHEN `h` LIKE '% cricket%' THEN 'cricket'
    WHEN `h` LIKE '% hockey%' THEN 'hockey'
    WHEN `h` LIKE '% snowboard%' THEN 'snowboarding'
    WHEN `h` LIKE '% skiing%' THEN 'skiing'
    WHEN `h` LIKE '% skateboard%' THEN 'skateboarding'
    WHEN `h` LIKE '% skating%' THEN 'skating'
    WHEN `h` LIKE '% golf%' THEN 'golf'
    WHEN `h` LIKE '% hiit%' OR `h` LIKE '% circuit%' OR `h` LIKE '% crossfit%' THEN 'gym'
    ELSE 'other'
  END AS `activity`
  FROM `named`
)
UPDATE `exercise_items`
SET `activity` = (SELECT `activity` FROM `refiled` WHERE `refiled`.`id` = `exercise_items`.`id`)
WHERE `activity` = 'other';
