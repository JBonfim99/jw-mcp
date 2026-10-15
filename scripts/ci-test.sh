#!/usr/bin/env bash
# Runs the test suite and surfaces failures as GitHub annotations, so they can
# be read through the API without downloading the raw job log.
set -uo pipefail
node --test --test-reporter=tap tests/wol-parsers.test.js tests/reference-input.test.js tests/usage-notice.test.js tests/auth/*.test.js tests/http-oauth.test.js > tap.txt 2>&1
status=$?
cat tap.txt
if [ $status -ne 0 ]; then
  node -e '
    const lines = require("fs").readFileSync("tap.txt", "utf8").split("\n");
    let out = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\s*not ok \d+ - (.*)$/);
      if (!m) continue;
      const body = [];
      for (let j = i + 1; j < Math.min(lines.length, i + 40); j++) {
        if (/^\s*(not )?ok \d+ /.test(lines[j])) break;
        body.push(lines[j].trim());
      }
      const msg = body.filter(l => /error|message|expected|actual|\+|-|at /.test(l)).slice(0, 25).join("\n");
      out.push(`::error title=${m[1].replace(/[:,]/g, " ")}::${msg.replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A")}`);
    }
    if (!out.length) out.push("::error title=tests failed::" + lines.slice(-30).join("%0A"));
    console.log(out.slice(0, 20).join("\n"));
  '
fi
exit $status
