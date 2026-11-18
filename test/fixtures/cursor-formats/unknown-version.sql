CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);
INSERT INTO cursorDiskKV VALUES ('composerData:new1', CAST('{"_v":99,"composerId":"new1","createdAt":1798761600000,"blocks":[1]}' AS BLOB));
INSERT INTO cursorDiskKV VALUES ('composerData:new2', CAST('{"_v":99,"composerId":"new2","createdAt":1798848000000}' AS BLOB));
