DROP TABLE IF EXISTS magazines;
CREATE TABLE magazines (
    ID TEXT PRIMARY KEY,
    Title TEXT,
    r2_base TEXT,
    thumb_path TEXT,
    post_url TEXT,
    slug TEXT
);
