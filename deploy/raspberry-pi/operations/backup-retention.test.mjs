import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const backupScript = await readFile(
  new URL("./backup.sh", import.meta.url),
  "utf8"
);

function forgetCommand(source) {
  const lines = source.split("\n");
  const start = lines.indexOf("restic forget \\");
  assert.notEqual(start, -1, "backup.sh must invoke restic forget");

  const endOffset = lines.slice(start).findIndex((line) => !line.endsWith("\\"));
  assert.notEqual(endOffset, -1, "restic forget command must terminate");
  return lines.slice(start, start + endOffset + 1).join("\n");
}

function groupKey(snapshot, fields) {
  return fields.map((field) => JSON.stringify(snapshot[field])).join("|");
}

test("retention ignores the unique backup staging path", () => {
  const command = forgetCommand(backupScript);
  const groups = [...command.matchAll(/--group-by ([a-z,]+)/gu)];

  assert.equal(groups.length, 1);
  assert.equal(groups[0][1], "host,tags");
  assert.match(command, /--keep-within "\$\{retention\}"/u);
  assert.match(command, /--prune/u);

  const fields = groups[0][1].split(",");
  const first = {
    host: "ruski-pi",
    tags: ["automated", "ruski-report"],
    paths: ["/var/lib/ruski-report-backup/run.first"]
  };
  const second = {
    ...first,
    paths: ["/var/lib/ruski-report-backup/run.second"]
  };

  assert.equal(groupKey(first, fields), groupKey(second, fields));
});
