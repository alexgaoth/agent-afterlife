CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);
INSERT INTO cursorDiskKV VALUES ('composerData:cur1', CAST('{"_v":10,"composerId":"cur1","name":"Add login","createdAt":1770714000000,"lastUpdatedAt":1770715800000,"modelConfig":{"modelName":"model-c"},"fullConversationHeadersOnly":[{"bubbleId":"b1","type":1},{"bubbleId":"b2","type":2},{"bubbleId":"b3","type":2},{"bubbleId":"b5","type":1}]}' AS BLOB));
INSERT INTO cursorDiskKV VALUES ('bubbleId:cur1:b1', CAST('{"_v":3,"bubbleId":"b1","type":1,"createdAt":"2026-02-10T09:00:00.000Z","text":"x"}' AS BLOB));
INSERT INTO cursorDiskKV VALUES ('bubbleId:cur1:b2', CAST('{"_v":3,"bubbleId":"b2","type":2,"createdAt":"2026-02-10T09:02:00.000Z","usage":{"input_tokens":100,"output_tokens":20},"toolFormerData":{"name":"edit_file_v2","params":"{}"}}' AS BLOB));
INSERT INTO cursorDiskKV VALUES ('bubbleId:cur1:b3', CAST('{"_v":3,"bubbleId":"b3","type":2,"timingInfo":{"clientRpcSendTime":1770714180000},"toolFormerData":{"name":"run_terminal_command_v2","rawArgs":"{\"command\": \"git commit -m x\"}"}}' AS BLOB));
INSERT INTO cursorDiskKV VALUES ('bubbleId:cur1:b4', CAST('{"_v":3,"bubbleId":"b4","type":1,"createdAt":"2026-02-10T09:04:00.000Z","text":"orphan of a rewound message"}' AS BLOB));
INSERT INTO cursorDiskKV VALUES ('bubbleId:cur1:b5', CAST('{"_v":3,"bubbleId":"b5","type":1,"createdAt":"2026-02-10T09:05:00.000Z","text":"y"}' AS BLOB));
INSERT INTO cursorDiskKV VALUES ('composerData:bad1', CAST('not json' AS BLOB));
INSERT INTO cursorDiskKV VALUES ('unrelated:key', CAST('{}' AS BLOB));
