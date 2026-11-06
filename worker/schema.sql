-- שורה אחת עם כל הנתונים של הצוות, וגרסה למניעת דריסה בין אחמ"שים
CREATE TABLE IF NOT EXISTS state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at INTEGER
);
